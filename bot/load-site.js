/* Завантажує config.js і storage.js сайту в Node, щоб бот рахував борги
   тими самими функціями, що й сторінка. Браузер імітуємо мінімально:
   storage.js на старті потребує лише window і addEventListener, а
   localStorage чіпає ліниво й у try. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SITE_DIR = path.join(__dirname, "..");

function loadSite() {
  const ctx = { console, addEventListener() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const file of ["config.js", "storage.js"]) {
    vm.runInContext(fs.readFileSync(path.join(SITE_DIR, file), "utf8"), ctx, { filename: file });
  }
  return { CONFIG: ctx.CONFIG, calc: ctx.Store.calc, Store: ctx.Store };
}

// Покласти борги й людей у стан storage.js — тоді загальні функції
// (totals, reliability, queue) рахують рівно те, що бачить сайт.
function withData(site, debts, users = []) {
  site.Store.state.debts = debts;
  site.Store.state.users = users;
  return site.calc;
}

module.exports = { loadSite, withData };
