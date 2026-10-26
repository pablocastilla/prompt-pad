import { test, expect } from '@playwright/test';
import { RemoteSessionsServer } from '../electron/remoteServer';
import { buildOpenCodeShScript, buildOpenCodeWinScript } from '../electron/launcherScripts';
import { resolveOpenCodeLaunchModel, DEFAULT_OPENCODE_MODEL } from '../electron/opencodeApi';
import type { OpenCodeSession } from '../electron/sessionTypes';
import { startFakeOpenCode, type FakeV2Form, type FakeV2Permission } from './fakeOpenCodeServer';

const SESSION_ID = 'ses_fake';

function session(overrides: Partial<OpenCodeSession> = {}): OpenCodeSession {
  const now = Date.now();
  return {
    id: SESSION_ID,
    turnId: SESSION_ID,
    title: 'V2 session',
    directory: 'C:\\projects\\v2',
    parentId: null,
    model: 'opencode/deepseek-v4.1-flash-free',
    status: 'working',
    createdAt: now - 5_000,
    updatedAt: now,
    completedAt: null,
    expiresAt: null,
    activity: [],
    source: 'opencode',
    ...overrides,
  };
}

function monitorWith(sessions: OpenCodeSession[]) {
  return {
    read: () => ({ dbPath: 'opencode.db', sessions, hiddenCount: 0, checkedAt: Date.now() }),
  } as unknown as ConstructorParameters<typeof RemoteSessionsServer>[0];
}

const form: FakeV2Form = {
  id: 'frm_1',
  sessionID: SESSION_ID,
  title: 'Storage choice',
  fields: [
    {
      key: 'db', type: 'string', title: 'Which database?', description: 'Pick one',
      options: [
        { value: 'pg', label: 'Postgres', description: 'Relational' },
        { value: 'mongo', label: 'Mongo', description: 'Document' },
      ],
      custom: true,
    },
    {
      key: 'extras', type: 'multiselect', title: 'Extras',
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
    },
  ],
};

const permission: FakeV2Permission = {
  id: 'per_1',
  sessionID: SESSION_ID,
  action: 'bash',
  resources: ['rm -rf build'],
  save: ['bash'],
};

test.describe('OpenCode 2 HTTP integration', () => {
  test('sends board messages through /api/session/:id/prompt', async () => {
    const fake = await startFakeOpenCode({ flavor: 'v2', sessionID: SESSION_ID });
    try {
      const server = new RemoteSessionsServer(monitorWith([session()]), null, { base: fake.url });
      const result = await server.sendToSessionForIpc(SESSION_ID, 'ship it');

      expect(result.id).toBe(SESSION_ID);
      const prompt = fake.last('POST', `/api/session/${SESSION_ID}/prompt`);
      expect(prompt).toBeDefined();
      expect(prompt?.body).toEqual({ text: 'ship it', delivery: 'steer' });
      // The old v1 endpoint must not be called against a v2 server.
      expect(fake.requests.some(request => request.path.includes('prompt_async'))).toBe(false);
    } finally {
      await fake.close();
    }
  });

  test('creates a shared session with the selected model and delivers the launch prompt', async () => {
    const fake = await startFakeOpenCode({ flavor: 'v2', sessionID: SESSION_ID });
    try {
      const server = new RemoteSessionsServer(monitorWith([]), null, { base: fake.url });
      const created = await server.createSessionWithPrompt({
        title: 'My prompt',
        prompt: 'Read the file at C:\\tmp\\prompt.txt',
        directory: 'C:\\projects\\v2',
        model: 'opencode/deepseek-v4.1-flash-free',
      });

      expect(created).toMatchObject({ id: 'ses_created_by_pad', promptSent: true, flavor: 'v2' });
      expect(created.serverUrl).toBe(fake.url);
      const sessionCreate = fake.last('POST', '/api/session');
      expect(sessionCreate?.body).toEqual({
        title: 'My prompt',
        location: { directory: 'C:\\projects\\v2' },
        model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' },
      });
      const prompt = fake.last('POST', '/api/session/ses_created_by_pad/prompt');
      expect(prompt?.body.text).toBe('Read the file at C:\\tmp\\prompt.txt');
    } finally {
      await fake.close();
    }
  });

  test('maps OpenCode 2 permissions and forms into the board question model', async () => {
    const fake = await startFakeOpenCode({
      flavor: 'v2', sessionID: SESSION_ID, forms: [form], permissions: [permission],
    });
    try {
      const server = new RemoteSessionsServer(monitorWith([session()]), null, { base: fake.url });
      const interactions = await server.listInteractions();

      expect(interactions.permissions).toEqual([{
        id: 'per_1', sessionID: SESSION_ID, permission: 'bash',
        patterns: ['rm -rf build'], always: ['bash'],
      }]);
      expect(interactions.questions).toHaveLength(1);
      const question = interactions.questions[0];
      expect(question.id).toBe('frm_1');
      expect(question.questions[0]).toMatchObject({
        header: 'Which database?', question: 'Pick one', custom: true, multiple: false,
      });
      expect(question.questions[0].options.map(option => option.label)).toEqual(['Postgres', 'Mongo']);
      expect(question.questions[1]).toMatchObject({ header: 'Extras', multiple: true, custom: false });

      // Replies travel to the session-scoped v2 endpoints with option VALUES.
      await server.replyPermission('per_1', 'always');
      const permissionReply = fake.last('POST', `/api/session/${SESSION_ID}/permission/per_1/reply`);
      expect(permissionReply?.body).toEqual({ decision: 'always' });

      await server.replyQuestion('frm_1', [['My own database'], ['Alpha', 'Beta']]);
      const formReply = fake.last('POST', `/api/session/${SESSION_ID}/form/frm_1/reply`);
      expect(formReply?.body).toEqual({ answer: { db: 'My own database', extras: ['a', 'b'] } });
    } finally {
      await fake.close();
    }
  });

  test('does not poll completed sessions for pending interactions', async () => {
    const fake = await startFakeOpenCode({ flavor: 'v2', sessionID: SESSION_ID, forms: [form], permissions: [permission] });
    try {
      const server = new RemoteSessionsServer(
        monitorWith([session({ status: 'completed', completedAt: Date.now(), expiresAt: Date.now() + 60_000 })]),
        null,
        { base: fake.url },
      );
      const interactions = await server.listInteractions();
      expect(interactions).toEqual({ permissions: [], questions: [] });
      expect(fake.requests.some(request => request.path.includes(`/api/session/${SESSION_ID}/form`))).toBe(false);
      expect(fake.requests.some(request => request.path.includes(`/api/session/${SESSION_ID}/permission`))).toBe(false);
    } finally {
      await fake.close();
    }
  });

  test('serves v2 interactions to the mobile page and sends from the phone', async () => {
    const fake = await startFakeOpenCode({
      flavor: 'v2', sessionID: SESSION_ID, forms: [form], permissions: [permission],
    });
    const server = new RemoteSessionsServer(monitorWith([session()]), null, { base: fake.url });
    const port = await server.start(0, '127.0.0.1');
    try {
      const key = server.accessToken;
      const payload = await fetch(`http://127.0.0.1:${port}/api/sessions?key=${encodeURIComponent(key)}`)
        .then(response => response.json());
      expect(payload.sendEnabled).toBe(true);
      expect(payload.sessions[0].permissions[0]).toMatchObject({ id: 'per_1', permission: 'bash' });
      expect(payload.sessions[0].questions[0]).toMatchObject({ id: 'frm_1' });
      expect(payload.sessions[0].questions[0].questions[0].header).toBe('Which database?');

      const send = await fetch(`http://127.0.0.1:${port}/api/send?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID, text: 'from the phone' }),
      });
      expect(send.status).toBe(200);
      await expect.poll(() => fake.last('POST', `/api/session/${SESSION_ID}/prompt`)?.body?.text)
        .toBe('from the phone');
    } finally {
      server.stop();
      await fake.close();
    }
  });

  test('keeps OpenCode 1 servers working through the flat API', async () => {
    const fake = await startFakeOpenCode({
      flavor: 'v1',
      sessionID: SESSION_ID,
      permissions: [permission],
      legacyQuestions: [{
        id: 'que_1', sessionID: SESSION_ID,
        questions: [{ header: 'Pick', question: 'Which one?', options: [{ label: 'One', description: '' }], custom: true }],
      }],
    });
    try {
      const server = new RemoteSessionsServer(monitorWith([session()]), null, { base: fake.url });
      await server.sendToSessionForIpc(SESSION_ID, 'v1 message');
      expect(fake.last('POST', `/session/${SESSION_ID}/prompt_async`)?.body).toEqual({
        parts: [{ type: 'text', text: 'v1 message' }],
      });

      const interactions = await server.listInteractions();
      expect(interactions.permissions).toHaveLength(1);
      expect(interactions.questions[0].id).toBe('que_1');

      await server.replyPermission('per_1', 'once');
      expect(fake.last('POST', '/permission/per_1/reply')?.body).toEqual({ reply: 'once' });
      await server.replyQuestion('que_1', [['One']]);
      expect(fake.last('POST', '/question/que_1/reply')?.body).toEqual({ answers: [['One']] });

      // v1 launch flow: minimal session body, model travels with the prompt.
      const created = await server.createSessionWithPrompt({
        title: 'v1 launch', prompt: 'v1 prompt', directory: 'C:\\projects\\v1',
        model: 'opencode/glm-5.3-flash',
      });
      expect(created).toMatchObject({ id: 'ses_created_by_pad', promptSent: true, flavor: 'v1' });
      const createCall = fake.requests.find(request =>
        request.method === 'POST' && request.path.startsWith('/session?directory='));
      expect(createCall?.body).toEqual({ title: 'v1 launch' });
      expect(fake.last('POST', '/session/ses_created_by_pad/prompt_async')?.body).toEqual({
        parts: [{ type: 'text', text: 'v1 prompt' }],
        model: { providerID: 'opencode', modelID: 'glm-5.3-flash' },
      });
    } finally {
      await fake.close();
    }
  });
});

test.describe('OpenCode launch script for the shared server', () => {
  test('Windows attach script opens the existing session instead of a private server', () => {
    const script = buildOpenCodeWinScript({
      cli: 'opencode',
      workDir: 'C:\\test\\work',
      sessionId: "ses_abc'123",
      yolo: true,
      launchTmpDir: 'C:\\test\\launch-tmp',
    });
    expect(script).toContain("$ocArgs = @('--session', 'ses_abc''123', '--auto')");
    expect(script).toContain('& $opencodePath @ocArgs');
    expect(script).not.toContain('--standalone');
    expect(script).not.toContain('OPENCODE_CONFIG');
    expect(script).toContain("Remove-Item -LiteralPath 'C:\\test\\launch-tmp' -Recurse -Force");
  });

  test('Unix attach script opens the existing session', () => {
    const script = buildOpenCodeShScript({
      cli: 'opencode',
      workDir: '/home/user/work',
      sessionId: 'ses_abc123',
      yolo: false,
      launchTmpDir: '/tmp/pp-launch-1',
    });
    expect(script).toContain('opencode --session "ses_abc123"');
    expect(script).not.toContain('--standalone');
    expect(script).not.toContain('OPENCODE_CONFIG');
  });

  test('OpenCode 1 attach script keeps the old server + password contract', () => {
    const options = {
      cli: 'opencode' as const,
      workDir: 'C:\\test\\work',
      sessionId: 'ses_v1',
      serverUrl: 'http://127.0.0.1:4096',
      password: 'p@ss',
      yolo: true,
      launchTmpDir: 'C:\\test\\launch-tmp',
    };
    const win = buildOpenCodeWinScript(options);
    expect(win).toContain("$ocArgs = @('attach', 'http://127.0.0.1:4096', '-s', 'ses_v1', '-p', 'p@ss')");
    expect(win).not.toContain('--auto');
    expect(win).not.toContain('--standalone');

    const unix = buildOpenCodeShScript({ ...options, workDir: '/home/user/work', launchTmpDir: '/tmp/pp-1' });
    expect(unix).toContain('opencode attach "http://127.0.0.1:4096" -s "ses_v1" -p "p@ss"');
    expect(unix).not.toContain('--auto');
  });

  test('stale pinned models fall back to the free default when the model list is known', () => {
    const available = [DEFAULT_OPENCODE_MODEL, 'opencode/glm-5.3-flash'];
    expect(resolveOpenCodeLaunchModel('opencode/minimax-m2.5-free', available)).toBe(DEFAULT_OPENCODE_MODEL);
    expect(resolveOpenCodeLaunchModel('opencode/glm-5.3-flash', available)).toBe('opencode/glm-5.3-flash');
    // Without a model list the selection is left untouched.
    expect(resolveOpenCodeLaunchModel('opencode/minimax-m2.5-free', [])).toBe('opencode/minimax-m2.5-free');
    expect(DEFAULT_OPENCODE_MODEL).toBe('opencode/deepseek-v4.1-flash-free');
  });
});
