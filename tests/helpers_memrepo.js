(function (root, factory) {
  'use strict';
  const api = factory(root.STCTV18 ? root.STCTV18.networkContract : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.STCTMemRepo = api;
})(globalThis, function (Contract) {
  'use strict';

  /*
   * 合成仓储 stub：内存实现 platformRepository.createRepository() 的公开接口，
   * 不依赖真实 IndexedDB。内容哈希沿用网络契约的公开 hashArtifact（与
   * platform-repository-v19.js 的 record() 同一口径），仅为构造合法记录，
   * 断言仍只看被测模块的公开输出。
   *
   * 测试控制（仅测试使用）：
   *   __gateRead({ store, id })  下一次匹配的 read() 会挂起，直到 gate.release()
   *                              id 为字符串＝精确匹配该记录读取；
   *                              id 为 null＝清单读取 read(store)。
   *                              gate.hit 在操作真正挂起时 resolve（配合超时使用）
   *   __gateOp({ store, skip })  第 skip+1 次对该 store 的仓储操作（read/commit/
   *                              removeMany）挂起，直到 gate.release()；用于制造
   *                              读取与提交之间的竞态窗口（不依赖被测实现的内部步骤）
   *   __seed(store, rows)        直接写入记录（夹具预置）
   *
   * gate.release() 同时解除未触发的挂起（幂等）。
   *
   * removeMany(entries, auditEntry, expected) 的第三参为可选的 CAS 期望版本：
   *   传数字或 { expectedRevision } 时，若目标 pointer 的当前版本不符则抛
   *   REVISION_CONFLICT 且不做任何删除（模拟“同一事务读取并比较 expectedRevision”）。
   *   不传则与 platform-repository-v19.js 的无条件删除语义一致（用于复现 F07 缺陷）。
   */

  const clone = value => structuredClone(value);
  const error = (code, detail) => Object.assign(new Error(code), { code, detail });

  function createRepository() {
    const stores = new Map();
    const listeners = new Set();
    const gates = [];
    const tableOf = name => {
      if (!stores.has(name)) stores.set(name, new Map());
      return stores.get(name);
    };
    const takeGate = (store, id, op) => {
      for (const gate of gates) {
        if (gate.used || gate.store !== store) continue;
        if (gate.kind === 'read') {
          if (op !== 'read' || !(gate.id === null ? id === undefined : gate.id === id)) continue;
        } else {
          if (gate.id !== undefined && gate.id !== id) continue;
          gate.seen += 1;
          if (gate.seen <= gate.skip) continue;
        }
        gate.used = true;
        gate.onHit();
        return gate;
      }
      return null;
    };
    const park = async gate => {
      if (!gate) return;
      await new Promise(resolve => { gate.releaseResolve = resolve; });
    };

    async function read(store, id) {
      await park(takeGate(store, id, 'read'));
      const table = tableOf(store);
      return id === undefined
        ? [...table.values()].map(clone)
        : (table.has(id) ? clone(table.get(id)) : undefined);
    }

    function record(id, payload, refs = []) {
      if (!id || typeof id !== 'string') throw error('RECORD_ID_REQUIRED');
      return { id, payload: clone(payload), refs: clone(refs), contentHash: Contract.hashArtifact(payload) };
    }

    async function commit(input) {
      await park(takeGate('pointers', input && input.pointer ? input.pointer.id : undefined, 'commit'));
      const batch = clone(input);
      const records = batch.records || {};
      for (const [name, rows] of Object.entries(records)) {
        for (const row of rows) {
          if (!row.id || row.contentHash !== Contract.hashArtifact(row.payload)) throw error('RECORD_HASH_INVALID');
        }
      }
      if (!batch.pointer?.id || !Number.isInteger(batch.expectedRevision) || batch.expectedRevision < 0) throw error('EXPECTED_REVISION_REQUIRED');
      const pointers = tableOf('pointers');
      const current = pointers.get(batch.pointer.id);
      if ((current?.revision || 0) !== batch.expectedRevision) throw error('REVISION_CONFLICT', { current: current?.revision || 0 });
      for (const [name, rows] of Object.entries(records)) {
        for (const row of rows) {
          const existing = tableOf(name).get(row.id);
          if (existing && existing.contentHash !== row.contentHash) throw error('IMMUTABLE_ID_COLLISION', { store: name, id: row.id });
        }
      }
      const pointer = { ...batch.pointer, revision: batch.expectedRevision + 1, savedAt: new Date().toISOString() };
      for (const [name, rows] of Object.entries(records)) {
        for (const row of rows) if (!tableOf(name).has(row.id)) tableOf(name).set(row.id, clone(row));
      }
      pointers.set(pointer.id, clone(pointer));
      for (const entry of batch.catalogEntries || []) tableOf('pointers').set(entry.id, clone(entry));
      if (batch.activeSelection) {
        tableOf('pointers').set('ACTIVE:' + pointer.scope, {
          id: 'ACTIVE:' + pointer.scope, scope: pointer.scope, type: 'SELECTION',
          selectedId: pointer.id, revision: pointer.revision, refs: clone(pointer.refs || [])
        });
      }
      listeners.forEach(listener => listener(clone(pointer)));
      return { status: 'SAVED', pointer: clone(pointer), performance: { storageCommitMs: 0, readbackMs: 0, evidenceClass: 'MEASURED' } };
    }

    async function removeMany(entries, auditEntry, expected) {
      for (const entry of entries) await park(takeGate(entry.store, entry.id, 'remove'));
      const expectedRevision = typeof expected === 'number'
        ? expected
        : expected && typeof expected.expectedRevision === 'number'
          ? expected.expectedRevision
          : (auditEntry && typeof auditEntry.expectedRevision === 'number' ? auditEntry.expectedRevision : null);
      if (expectedRevision != null) {
        for (const { store, id } of entries) {
          if (store !== 'pointers') continue;
          const current = tableOf('pointers').get(id);
          if (current && (current.revision || 0) !== expectedRevision) {
            throw error('REVISION_CONFLICT', { expected: expectedRevision, current: current.revision || 0, id });
          }
        }
      }
      for (const { store, id } of entries) tableOf(store).delete(id);
      if (auditEntry) tableOf('audit').set(auditEntry.id, clone(auditEntry));
    }

    const makeGate = spec => {
      const gate = { ...spec, used: false, seen: 0, releaseResolve: null };
      gate.hit = new Promise(resolve => { gate.onHit = resolve; });
      gate.release = () => { gate.used = true; if (gate.releaseResolve) gate.releaseResolve(); };
      gates.push(gate);
      return gate;
    };
    function __gateRead(match = {}) {
      return makeGate({ kind: 'read', store: match.store, id: match.id === undefined ? null : match.id, skip: 0 });
    }
    function __gateOp(match = {}) {
      return makeGate({ kind: 'op', store: match.store, id: match.id, skip: match.skip || 0 });
    }

    function __seed(store, rows) {
      for (const row of rows) tableOf(store).set(row.id, clone(row));
    }

    return Object.freeze({
      open: async () => true,
      read,
      list: store => read(store),
      record,
      commit,
      removeMany,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      close() { listeners.clear(); },
      diagnostics() { return { schemaVersion: 4, storage: 'MEMORY_STUB', database: 'stct-test-memrepo', listenerCount: listeners.size, metrics: [], open: true, boundary: 'TEST_MEMORY_ONLY' }; },
      __gateRead,
      __gateOp,
      __seed
    });
  }

  return Object.freeze({ createRepository });
});
