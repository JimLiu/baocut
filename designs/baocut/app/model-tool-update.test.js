const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-tool-update.js');
const U = global.window.BC_TOOL_UPDATE;

test('命令行（POSIX）：安全的参数原样，带方括号、空格、引号的加单引号', () => {
  assert.equal(U.commandLine(['/opt/homebrew/bin/brew', 'upgrade', 'yt-dlp'], 'darwin'), '/opt/homebrew/bin/brew upgrade yt-dlp');
  assert.equal(U.commandLine(['python3', '-m', 'pip', 'install', '-U', 'yt-dlp[default]'], 'darwin'), "python3 -m pip install -U 'yt-dlp[default]'");
  assert.equal(U.commandLine(['/Users/a b/yt-dlp', '-U'], 'linux'), "'/Users/a b/yt-dlp' -U");
  assert.equal(U.commandLine(["it's", ''], 'darwin'), "'it'\\''s' ''");
});

test('命令行（Windows）：按 PowerShell 加单引号，单引号与弯引号写两遍，第一个词加了引号时前面加 &', () => {
  assert.equal(U.commandLine(['C:\\Tools\\yt-dlp.exe', '-U'], 'win32'), 'C:\\Tools\\yt-dlp.exe -U');
  assert.equal(U.commandLine(['C:\\Program Files\\yt-dlp\\yt-dlp.exe', '-U'], 'win32'), "& 'C:\\Program Files\\yt-dlp\\yt-dlp.exe' -U");
  assert.equal(U.commandLine(['py', '-m', 'pip', 'install', '-U', 'yt-dlp[default]'], 'win32'), "py -m pip install -U 'yt-dlp[default]'");
  assert.equal(U.commandLine(['C:\\x\\a.exe', "it's", 'a\u2019b', '$env:X', ''], 'win32'), "C:\\x\\a.exe 'it''s' 'a\u2019\u2019b' '$env:X' ''");
});

test('演示的更新办法：按主机写命令；要管理员权限的 macOS 上加 sudo、Windows 上不加；判断不了的没有办法', () => {
  const mac = U.DEMO_PLANS.darwin;
  const win = U.DEMO_PLANS.win32;
  assert.equal(mac.homebrew.plan.command, '/opt/homebrew/bin/brew upgrade yt-dlp');
  assert.equal(mac.admin.plan.runnable, false);
  assert.equal(mac.admin.plan.command, 'sudo /usr/local/bin/yt-dlp -U');
  assert.equal(mac.unknown.plan, null);
  assert.equal(win.admin.plan.command, "& 'C:\\Program Files\\yt-dlp\\yt-dlp.exe' -U");
  assert.equal(win.chocolatey.plan.runnable, false);
  assert.equal(win.chocolatey.plan.command, 'choco upgrade yt-dlp');
  assert.match(win.winget.plan.command, /winget\.exe upgrade --id yt-dlp\.yt-dlp --exact --source winget /);
  assert.match(win.scoop.plan.command, /powershell\.exe -NoProfile -ExecutionPolicy Unrestricted -File \S+\\scoop\.ps1 update yt-dlp$/);
  assert.equal(win.unknown.plan, null);
  for (const {k} of U.DEMO_HOSTS) {
    assert.deepEqual(U.DEMO_METHODS[k].map((m) => m.k).sort(), Object.keys(U.DEMO_PLANS[k]).sort(), k);
    for (const demo of Object.values(U.DEMO_PLANS[k])) if (demo.plan) assert.ok(U.LABEL[demo.plan.method], `${k}/${demo.plan.method}`);
  }
});

test('换了主机：原来的安装方式这边没有时用这台主机的第一种', () => {
  assert.equal(U.demoPlan('win32', 'homebrew'), U.DEMO_PLANS.win32.winget);
  assert.equal(U.demoPlan('darwin', 'scoop'), U.DEMO_PLANS.darwin.homebrew);
  assert.equal(U.demoPlan('win32', 'pip'), U.DEMO_PLANS.win32.pip);
  assert.equal(U.demoPlan('linux', 'pip'), U.DEMO_PLANS.darwin.pip);
});

test('「更新」一节的文案：能执行的只写安装方式，不能执行的交给终端并说明原因，判断不了的按主机列常见做法', () => {
  assert.deepEqual(U.sectionCopy(U.DEMO_PLANS.darwin.homebrew.plan), {label: '用 Homebrew 更新', hint: null});
  assert.equal(U.sectionCopy(U.DEMO_PLANS.darwin.pip.plan).label, '用 pip 更新');
  assert.equal(U.sectionCopy(U.DEMO_PLANS.win32.winget.plan).label, '用 winget 更新');
  assert.equal(U.sectionCopy(U.DEMO_PLANS.win32.scoop.plan).label, '用 Scoop 更新');
  assert.equal(U.sectionCopy(U.DEMO_PLANS.darwin.admin.plan).label, '在终端里更新');
  assert.match(U.sectionCopy(U.DEMO_PLANS.darwin.admin.plan).hint, /管理员权限.*在终端里执行这条命令，完成后点「重新检测」。$/);
  /* Windows 的原因里已经说了用管理员身份执行，不再重复「执行这条命令」 */
  for (const k of ['admin', 'chocolatey']) {
    const hint = U.sectionCopy(U.DEMO_PLANS.win32[k].plan).hint;
    assert.equal(hint.split('执行这条命令').length, 2, k);
    assert.match(hint, /用管理员身份打开终端执行这条命令。完成后点「重新检测」。$/);
  }
  assert.match(U.sectionCopy({method: 'standalone', runnable: false, reason: null}).hint, /^BaoCut 不能代为执行这条命令。在终端里执行/);
  assert.match(U.sectionCopy(null).hint, /判断不了.*重新检测/);
  assert.deepEqual(U.manual('darwin').map((m) => m.label), ['Homebrew', 'pip', '官方独立程序']);
  assert.deepEqual(U.manual('linux'), U.manual('darwin'));
  assert.deepEqual(U.manual('win32').map((m) => m.command), ['winget upgrade yt-dlp.yt-dlp', 'scoop update yt-dlp', 'py -m pip install -U "yt-dlp[default]"', 'yt-dlp -U']);
});

test('结果：命令成败说退出码，成功时按重新检测的版本说更新到哪或已是最新，停止的不猜', () => {
  assert.deepEqual(U.summary({method: 'homebrew', exitCode: 0, before: '2026.07.04', after: '2026.09.30'}), {tone: 'positive', title: '已更新到 2026.09.30', body: null});
  assert.equal(U.summary({method: 'pip', exitCode: 0, before: '2026.07.04', after: '2026.07.04'}).title, '已是最新版本 2026.07.04');
  const failed = U.summary({method: 'pip', exitCode: 1, before: '2026.07.04', after: '2026.07.04'});
  assert.equal(failed.tone, 'negative');
  assert.equal(failed.title, '更新没有完成（退出码 1）');
  assert.equal(U.summary({cancelled: true, exitCode: null, before: '2026.07.04'}).tone, 'notice');
});

test('winget 没有可升级的版本时以 0x8A15002B 退出：算成功，说已是最新；别的方式这个退出码仍是失败', () => {
  assert.ok(U.succeeded('winget', U.WINGET_NO_UPDATE));
  assert.ok(!U.succeeded('scoop', U.WINGET_NO_UPDATE));
  assert.ok(!U.succeeded('winget', 1));
  assert.equal(U.summary({method: 'winget', exitCode: U.WINGET_NO_UPDATE, before: '2026.07.04', after: '2026.07.04'}).title, '已是最新版本 2026.07.04');
  assert.equal(U.summary({method: 'standalone', exitCode: U.WINGET_NO_UPDATE, before: '2026.07.04', after: '2026.07.04'}).title, '更新没有完成（退出码 0x8A15002B）');
  assert.equal(U.exitCodeText(-1978335189), '0x8A15002B');
  assert.equal(U.exitCodeText(2), '2');
});

test('演示输出：每台主机上能代为执行的办法与每种结果都有几行', () => {
  for (const {k: host} of U.DEMO_HOSTS) {
    const methods = new Set(Object.values(U.DEMO_PLANS[host]).filter((d) => d.plan && d.plan.runnable).map((d) => d.plan.method));
    for (const method of methods) {
      for (const {k} of U.DEMO_OUTCOMES) assert.ok(U.demoOutput(method, k, '2026.07.04', '2026.09.30', host).length >= 1, `${host}/${method}/${k}`);
    }
  }
  assert.ok(U.demoOutput('homebrew', 'updated', '2026.07.04', '2026.09.30', 'darwin').includes('yt-dlp 2026.07.04 -> 2026.09.30'));
  assert.ok(U.demoOutput('winget', 'updated', '2026.07.04', '2026.09.30', 'win32').includes('Found yt-dlp [yt-dlp.yt-dlp] Version 2026.09.30'));
  assert.ok(U.demoOutput('pip', 'failed', '2026.07.04', '2026.09.30', 'win32').some((l) => /WinError 32/.test(l)));
});
