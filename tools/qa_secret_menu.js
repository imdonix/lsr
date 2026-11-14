// Secret mission list regression test.
//   node tools/play.js tools/qa_secret_menu.js --exe /usr/bin/google-chrome
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { invincible: true });
  await ctx.eval(() => {
    G.menus.hideAll(); G.paused = false; G.game.state = 'play'; G.game.inCutscene = false;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true }));
  });
  const info = await ctx.eval(() => ({
    open: G.menus.open,
    panel: !!(document.getElementById('secretPanel') && document.getElementById('secretPanel').classList.contains('show')),
    rows: document.querySelectorAll('[data-secret]').length,
    defs: G.missions.defs.length,
    first: document.querySelector('[data-secret]')?.dataset.secret || null,
  }));
  console.log('SECRET_MENU', JSON.stringify(info));
  if (info.open !== 'secret' || !info.panel || info.rows !== info.defs || info.rows < 48) throw new Error('secret mission menu failed: ' + JSON.stringify(info));
  const picked = await ctx.eval(() => {
    const M = G.missions, orig = M.start;
    let id = null;
    M.start = (def) => { id = def.id; return Promise.resolve(); };
    document.querySelector('[data-secret="m05"]').click();
    M.start = orig;
    G.missions.abortAll(); G.menus.hideAll(); G.paused = false;
    return id;
  });
  console.log('SECRET_PICK', picked);
  if (picked !== 'm05') throw new Error('secret mission start did not select m05');
};
