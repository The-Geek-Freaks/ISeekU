const {
  chooseMechanism,
  willBeUnencrypted,
  assertNoDowngrade,
  InsecureServerError,
  NoUsableMechanismError,
} = require('./icq-auth-policy');

describe('choosing a mechanism on an encrypted stream', () => {
  it('takes the server first choice', () => {
    expect(chooseMechanism({ mechanisms: ['SCRAM-SHA-1', 'PLAIN'], secure: true })).toBe('SCRAM-SHA-1');
  });

  it('accepts PLAIN once the stream is encrypted, without an opt-in', () => {
    // PLAIN inside TLS is normal and safe; the warning is about cleartext.
    expect(chooseMechanism({ mechanisms: ['PLAIN'], secure: true })).toBe('PLAIN');
  });
});

describe('choosing a mechanism on an unencrypted stream', () => {
  it('prefers any mechanism that does not reveal the password', () => {
    expect(chooseMechanism({ mechanisms: ['PLAIN', 'SCRAM-SHA-1'], secure: false })).toBe('SCRAM-SHA-1');
  });

  it('needs no opt-in when a non-PLAIN mechanism is available', () => {
    expect(() => chooseMechanism({ mechanisms: ['SCRAM-SHA-1'], secure: false, allowInsecure: false })).not.toThrow();
  });

  it('refuses PLAIN-only without an explicit opt-in', () => {
    // This is icqr.net. Refusing by default is the whole point.
    expect(() => chooseMechanism({ mechanisms: ['PLAIN'], secure: false, server: 'icqr' }))
      .toThrow(InsecureServerError);
  });

  it('explains why it refused, naming the server', () => {
    expect(() => chooseMechanism({ mechanisms: ['PLAIN'], secure: false, server: '132.145.202.182' }))
      .toThrow(/132\.145\.202\.182[\s\S]*readable form/);
  });

  it('allows PLAIN-only when the Owner opted in for this server', () => {
    expect(chooseMechanism({ mechanisms: ['PLAIN'], secure: false, allowInsecure: true })).toBe('PLAIN');
  });

  it('carries the offered mechanisms on the error for the warning dialog', () => {
    try {
      chooseMechanism({ mechanisms: ['PLAIN'], secure: false, server: 'x' });
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe('INSECURE_SERVER');
      expect(err.mechanisms).toEqual(['PLAIN']);
    }
  });
});

describe('when no mechanism is usable', () => {
  it('refuses an empty mechanism list distinctly from an insecure one', () => {
    expect(() => chooseMechanism({ mechanisms: [], secure: true })).toThrow(NoUsableMechanismError);
  });

  it('does not treat an empty list as an opt-in problem', () => {
    // The Owner cannot fix this by accepting a warning, so it must not be
    // reported as one.
    try {
      chooseMechanism({ mechanisms: [], secure: false, allowInsecure: true });
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe('NO_USABLE_MECHANISM');
    }
  });
});

describe('predicting the warning', () => {
  it('warns for a cleartext PLAIN-only server', () => {
    expect(willBeUnencrypted({ mechanisms: ['PLAIN'], secure: false })).toBe(true);
  });

  it('does not warn once encrypted', () => {
    expect(willBeUnencrypted({ mechanisms: ['PLAIN'], secure: true })).toBe(false);
  });

  it('does not warn when a challenge-response mechanism is on offer', () => {
    expect(willBeUnencrypted({ mechanisms: ['SCRAM-SHA-1', 'PLAIN'], secure: false })).toBe(false);
  });
});

describe('downgrade protection', () => {
  it('refuses a server that has stopped offering encryption', () => {
    expect(() => assertNoDowngrade({ server: 'example.org', secure: false, wasSecurePreviously: true }))
      .toThrow(/interception/);
  });

  it('allows a server that was never encrypted to stay that way', () => {
    // icqr.net has always been cleartext; that is not a downgrade.
    expect(() => assertNoDowngrade({ server: 'icqr', secure: false, wasSecurePreviously: false })).not.toThrow();
  });

  it('allows a server that gained encryption', () => {
    expect(() => assertNoDowngrade({ server: 'icqr', secure: true, wasSecurePreviously: false })).not.toThrow();
  });
});
