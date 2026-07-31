/**
 * The stanza helpers are the only non-obvious logic in the probe: everything
 * else is sockets. These tests pin the framing rules that a hand-rolled XMPP
 * reader gets wrong — split stanzas, self-closing tags, and nested same-name
 * elements.
 */

const { parseArgs, drainStanzas, collectAttr, collectText, escapeXml } = require('./probe-server');

describe('parseArgs', () => {
  it('defaults the XMPP domain to the server host', () => {
    // icqr.net serves its own IP as the domain, so this default is load-bearing.
    const args = parseArgs(['--uin', '123', '--server', '132.145.202.182']);
    expect(args.domain).toBe('132.145.202.182');
    expect(args.port).toBe(5222);
  });

  it('keeps an explicit domain that differs from the host', () => {
    const args = parseArgs(['--uin', '1', '--server', '10.0.0.1', '--domain', 'example.org']);
    expect(args.domain).toBe('example.org');
  });

  it('rejects a flag whose value is missing', () => {
    expect(() => parseArgs(['--uin', '--server', 'host'])).toThrow(/Missing value for --uin/);
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});

describe('drainStanzas', () => {
  it('returns complete stanzas and keeps the partial tail buffered', () => {
    const { stanzas, rest } = drainStanzas("<iq id='1'><query/></iq><message><bo");
    expect(stanzas).toEqual(["<iq id='1'><query/></iq>"]);
    expect(rest).toBe('<message><bo');
  });

  it('handles a self-closing top-level stanza', () => {
    const { stanzas, rest } = drainStanzas("<presence from='a@b'/><presence from='c@d'/>");
    expect(stanzas).toHaveLength(2);
    expect(rest).toBe('');
  });

  it('does not split on a nested element sharing the parent name', () => {
    // A naive indexOf('</iq>') would still be correct here, but a naive
    // "first closing tag of any name" reader would truncate mid-stanza.
    const xml = "<iq type='result'><query xmlns='jabber:iq:roster'>"
      + "<item jid='1@x'/><item jid='2@x'/></query></iq>";
    const { stanzas, rest } = drainStanzas(xml);
    expect(stanzas).toEqual([xml]);
    expect(rest).toBe('');
  });

  it('emits nothing while a stanza is still incomplete', () => {
    const { stanzas, rest } = drainStanzas('<iq><query>');
    expect(stanzas).toEqual([]);
    expect(rest).toBe('<iq><query>');
  });

  it('tolerates whitespace keepalives between stanzas', () => {
    const { stanzas } = drainStanzas("<presence/>\n \n<presence/>");
    expect(stanzas).toHaveLength(2);
  });
});

describe('collectAttr', () => {
  it('collects one attribute across repeated elements', () => {
    const xml = "<query><feature var='urn:xmpp:ping'/><feature var='vcard-temp'/></query>";
    expect(collectAttr(xml, 'feature', 'var')).toEqual(['urn:xmpp:ping', 'vcard-temp']);
  });

  it('reads double-quoted attributes as well as single', () => {
    expect(collectAttr('<item jid="a@b"/>', 'item', 'jid')).toEqual(['a@b']);
  });

  it('does not match an element whose name merely starts the same', () => {
    // <features> must not be picked up when asking for <feature>.
    const xml = "<featureset var='no'/><feature var='yes'/>";
    expect(collectAttr(xml, 'feature', 'var')).toEqual(['yes']);
  });

  it('returns empty when the attribute is absent', () => {
    expect(collectAttr('<feature/>', 'feature', 'var')).toEqual([]);
  });
});

describe('collectText', () => {
  it('collects text from repeated elements', () => {
    const xml = '<mechanisms><mechanism>PLAIN</mechanism><mechanism>SCRAM-SHA-1</mechanism></mechanisms>';
    expect(collectText(xml, 'mechanism')).toEqual(['PLAIN', 'SCRAM-SHA-1']);
  });

  it('trims surrounding whitespace', () => {
    expect(collectText('<name>\n  Openfire\n</name>', 'name')).toEqual(['Openfire']);
  });

  it('returns empty for a self-closing element', () => {
    expect(collectText('<name/>', 'name')).toEqual([]);
  });
});

describe('escapeXml', () => {
  it('escapes every character that would break an attribute or body', () => {
    expect(escapeXml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
  });

  it('escapes the ampersand before the entities it introduces', () => {
    // Order matters: escaping < first would turn "&lt;" into "&amp;lt;".
    expect(escapeXml('<')).toBe('&lt;');
  });
});
