// Regression: retrying a FAILED pause-menu replay must stay a replay (40% pay, no respect, no afterDone,
// no story progress). Normal (non-replay) failures must still retry at full pay / respect / afterDone.
// node tools/play.js tools/qa_mission_retry_replay.js --url http://127.0.0.1:8123/index.html --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (c) => {
  await install(c);
  await boot(c, { empty: true });
  let checks = 0, fails = 0;
  const ok = (name, cond, extra = '') => { checks++; if (!cond) fails++; c.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

  const r = await c.eval(async () => {
    const { MissionFail } = await import('/src/missions.js');
    const M = G.missions, pl = G.player;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const waitFor = async (fn, ms = 8000) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) return false; await sleep(20); } return true; };

    const RID = 'qa_rr_replay', NID = 'qa_rr_normal';
    const phase = { [RID]: 'fail', [NID]: 'fail' };
    const afterDone = { [RID]: 0, [NID]: 0 };
    const mk = (id) => ({
      id, title: 'QA ' + id,
      run: async (r) => { if (phase[id] === 'fail') throw new MissionFail('QA forced failure'); r.reward(1000, 10); },
      afterDone: () => { afterDone[id]++; }
    });
    const defR = mk(RID), defN = mk(NID);

    // spy money exactly: only positive mission payouts
    let paid = 0;
    const hadAdd = Object.prototype.hasOwnProperty.call(pl, 'addMoney'), origAdd = pl.addMoney;
    const hadSave = Object.prototype.hasOwnProperty.call(G.game, 'canSave'), origSave = G.game.canSave;
    pl.addMoney = function (n, ...a) { if (n > 0) paid += n; return origAdd.call(pl, n, ...a); };
    G.game.canSave = () => false;   // do not wait 2.5 s / save after the pass path

    try {
      M.defs.push(defR, defN);
      M.done.delete(NID); M.done.add(RID);

      // ---- A: replay -> fail -> retry(fail) -> retry(pass): must stay replay
      const aDone0 = M.done.has(RID), aStats0 = pl.stats.missions, aResp0 = pl.respect;
      phase[RID] = 'fail'; paid = 0;
      await M.start(defR, { replay: true });
      await waitFor(() => M.lastFailed === defR && !M.active);
      await sleep(500);   // failure tail: noStartUntil / refreshStarts
      const a1 = { paid, failed: M.lastFailed === defR, replay: M.lastFailedReplay };
      phase[RID] = 'fail';
      M.retryLast();
      await waitFor(() => M.lastFailed === defR && !M.active);
      await sleep(500);
      const a2 = { paid, failed: M.lastFailed === defR, replay: M.lastFailedReplay };
      phase[RID] = 'pass';
      M.retryLast();
      await waitFor(() => !M.active);
      await sleep(800);   // settle the pass path
      const a3 = { paid, resp: pl.respect, after: afterDone[RID], done: M.done.has(RID), stats: pl.stats.missions };

      // ---- B: normal (no replay) -> fail -> retry(pass): full pay / respect / afterDone
      const bStats0 = pl.stats.missions, bResp0 = pl.respect, bDone0 = M.done.has(NID);
      phase[NID] = 'fail'; paid = 0;
      await M.start(defN);
      await waitFor(() => M.lastFailed === defN && !M.active);
      await sleep(500);
      const b1 = { paid, replay: M.lastFailedReplay };
      phase[NID] = 'pass';
      M.retryLast();
      await waitFor(() => !M.active);
      await sleep(800);
      const b2 = { paid, resp: pl.respect, after: afterDone[NID], done: M.done.has(NID), stats: pl.stats.missions };

      // ---- C: clearRetry wipes the replay failure flag
      phase[RID] = 'fail'; paid = 0;
      await M.start(defR, { replay: true });
      await waitFor(() => M.lastFailed === defR && !M.active);
      await sleep(500);
      const c1 = { lastFailed: !!M.lastFailed, replay: M.lastFailedReplay };
      M.clearRetry();
      const c2 = { lastFailed: M.lastFailed, replay: M.lastFailedReplay };
      return {
        aDone0, aStats0, aResp0, a1, a2, a3,
        bStats0, bResp0, bDone0, b1, b2,
        c1, c2
      };
    } finally {
      M.abortAll();
      M.defs = M.defs.filter(d => d.id !== RID && d.id !== NID);
      M.done.delete(RID); M.done.delete(NID);
      M.clearRetry();
      if (hadAdd) pl.addMoney = origAdd; else delete pl.addMoney;
      if (hadSave) G.game.canSave = origSave; else delete G.game.canSave;
      G.game.suppressPause = false;
    }
  });
  // A: the replay flag survives failures and retries
  ok('A replay fail: phase-1 payout 0', r.a1.paid === 0, JSON.stringify(r.a1));
  ok('A replay fail: retry still replay', r.a2.replay === true && r.a2.paid === 0, JSON.stringify(r.a2));
  ok('A replay retry pass: pays 40% (400)', r.a3.paid === 400, JSON.stringify(r.a3));
  ok('A replay retry pass: no respect', r.a3.resp === r.aResp0, JSON.stringify({ resp0: r.aResp0, after: r.a3.resp }));
  ok('A replay retry pass: afterDone not run', r.a3.after === 0, JSON.stringify(r.a3));
  ok('A replay retry pass: stays in done', r.a3.done === true, JSON.stringify(r.a3));
  ok('A replay retry pass: stats.missions unchanged', r.a3.stats === r.aStats0, JSON.stringify({ stats0: r.aStats0, after: r.a3.stats }));
  ok('A replay: was in done before start', r.aDone0 === true);

  // B: normal retry is untouched
  ok('B normal fail: no payout, not flagged replay', r.b1.paid === 0 && !r.b1.replay, JSON.stringify(r.b1));
  ok('B normal retry pass: pays 100% (1000)', r.b2.paid === 1000, JSON.stringify(r.b2));
  ok('B normal retry pass: respect +10', r.b2.resp === r.bResp0 + 10, JSON.stringify({ resp0: r.bResp0, after: r.b2.resp }));
  ok('B normal retry pass: afterDone once', r.b2.after === 1, JSON.stringify(r.b2));
  ok('B normal retry pass: added to done', r.bDone0 === false && r.b2.done === true, JSON.stringify({ before: r.bDone0, after: r.b2.done }));
  ok('B normal retry pass: stats.missions +1', r.b2.stats === r.bStats0 + 1, JSON.stringify({ stats0: r.bStats0, after: r.b2.stats }));

  // C: clearRetry clears both fields
  ok('C replay failure records replay flag', r.c1.lastFailed === true && r.c1.replay === true, JSON.stringify(r.c1));
  ok('C clearRetry clears lastFailed + replay flag', r.c2.lastFailed === null && r.c2.replay === false, JSON.stringify(r.c2));

  c.log('RESULT ' + (checks - fails) + '/' + checks);
};
