// Local DevTools verification only. Not part of the mini-program package.
import { fileURLToPath } from 'node:url';
import automator from '/Users/fan/.npm/_npx/cf54c79a0524a233/node_modules/miniprogram-automator/out/index.js';
import miniProgramModule from '/Users/fan/.npm/_npx/cf54c79a0524a233/node_modules/miniprogram-automator/out/MiniProgram.js';
// Installed DevTools RC returns an empty version; skip only the SDK version comparison.
miniProgramModule.default.prototype.checkVersion = async function() {};
(async () => {
  let mini;
  try {
    mini = await automator.launch({cliPath:'/Applications/wechatwebdevtools.app/Contents/MacOS/cli',projectPath:process.cwd()+'/dist/miniprogram-live-preview',port:9432,timeout:45000});
    console.log('CONNECTED');
    const page = await mini.reLaunch('/pages/intent-entry/index');
    await page.waitFor(500);
    console.log(JSON.stringify({system:await mini.systemInfo(),path:page.path}));
    await mini.screenshot({path:fileURLToPath(new URL('../2026-09-10/home.png', import.meta.url))});
  } finally { if (mini) mini.disconnect(); }
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
