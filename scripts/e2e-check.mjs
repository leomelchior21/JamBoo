import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const SHOT = process.env.JAMBOO_SHOT_DIR || tmpdir();
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}${name}${detail ? ` —${detail}` : ''}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await context.newPage();
const pageErrors = [];
const apiCalls = [];
page.on('pageerror', error => pageErrors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
page.on('request', request => { if (request.url().includes('/api/')) apiCalls.push(request.url()); });

async function fresh() {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('#add-topic-btn');
  await page.evaluate(() => localStorage.clear());
}

async function setBoard(columns, rows) {
  await page.click(`.led-cell[data-c="${columns - 1}"][data-r="${rows - 1}"]`);
}

async function addTopic(subject, topic) {
  await page.click('#add-topic-btn');
  await page.waitForSelector('.miller-item');
  await page.click(`.miller-item:has-text("${subject}")`);
  await page.waitForTimeout(120);
  await page.click(`.miller-item:has-text("${topic}")`);
  await page.waitForTimeout(150);
  await page.click('.miller-all');
  await page.waitForTimeout(150);
}

async function addSubtopic(subject, topic, subtopic) {
  await page.click('#add-topic-btn');
  await page.waitForSelector('.miller-item');
  await page.click(`.miller-item:has-text("${subject}")`);
  await page.waitForTimeout(120);
  await page.click(`.miller-item:has-text("${topic}")`);
  await page.waitForTimeout(180);
  await page.click(`.miller-item:has-text("${subtopic}")`);
  await page.waitForTimeout(200);
}

/* ─────────── TEST A: 4x5, Fractions x2 + Solar System x2 ─────────── */
await fresh();
await setBoard(4, 5);
await addTopic('Mathematics', 'Fractions');
await addTopic('Science', 'Solar System');
const meter = (await page.textContent('#columns-meter')).replace(/\s+/g, ' ').trim();
check('A: meter reads 4 / 4 assigned', meter.includes('4 / 4'), meter);
const previewHeads = await page.$$eval('.bp-head', nodes => nodes.map(node => node.textContent));
check('A: preview has 4 labelled columns', JSON.stringify(previewHeads) === JSON.stringify(['Fractions I', 'Fractions II', 'Solar System I', 'Solar System II']), previewHeads.join(' | '));
const createEnabled = await page.isEnabled('#gen-btn');
check('A: CREATE JAMBOO enabled', createEnabled);
await page.screenshot({ path: `${SHOT}/builder-desktop.png` , fullPage: true });

await page.click('#gen-btn');
await page.waitForURL('**/game.html', { timeout: 10000 });
await page.waitForSelector('#game-wrap.ready', { timeout: 10000 });
const session = await page.evaluate(() => JSON.parse(localStorage.getItem('jamboo_config')).session);
const uniqueIds = new Set(session.questionIds);
check('A: session has 20 unique questions', session.questionIds.length === 20 && uniqueIds.size === 20, `${uniqueIds.size} unique`);
check('A: 10 fractions + 10 solar questions', session.columnTopics.filter(id => id === 'fractions').length === 2 && session.columnTopics.filter(id => id === 'solar-system').length === 2);
check('A: answer indices spread', new Set(session.questions.flat().map(q => q.correctIndex)).size >= 3);
const boardCells = await page.$$eval('.q-cell', nodes => nodes.length);
const catCells = await page.$$eval('.cat-cell', nodes => nodes.map(node => node.textContent));
check('A: board rendered 20 cells', boardCells === 20, String(boardCells));
check('A: board headers match session', JSON.stringify(catCells) === JSON.stringify(session.categories), catCells.join(' | '));

/* ─────────── TEST J: gameplay still works ─────────── */
await page.click('.q-cell:not(.used)');
await page.waitForSelector('#q-modal.active');
const options = await page.$$eval('.mc-opt', nodes => nodes.length);
check('J: question modal shows 4 choices', options === 4, String(options));
await page.click('.mc-opt:nth-child(1)');
await page.waitForSelector('.team-pick-btn:not([disabled])', { timeout: 12000 });
await page.click('.team-pick-btn:nth-child(1)');
await page.waitForTimeout(900);
const score = await page.textContent('#sv-0');
check('J: points awarded after answering', score === '100' || score === '-100', score);
const usedCells = await page.$$eval('.q-cell.used', nodes => nodes.length);
check('J: answered cell marked used', usedCells === 1, String(usedCells));
await page.screenshot({ path: `${SHOT}/game-board.png` , fullPage: true });

/* ─────────── TEST D: 3/4 assigned blocks creation ─────────── */
await fresh();
await setBoard(4, 5);
await addTopic('Mathematics', 'Fractions');
await page.click('.topic-card .col-stepper .step-btn.sm:first-of-type');
const meterD = (await page.textContent('#columns-meter')).replace(/\s+/g, ' ').trim();
const statusD = (await page.textContent('#build-status')).trim();
const createD = await page.isEnabled('#gen-btn');
check('D: 3/4 blocks CREATE', !createD && meterD.includes('3 / 4') && statusD.length > 0, `${meterD} ::${statusD}`);

/* ─────────── TEST E: cannot exceed board columns ─────────── */
await page.click('.topic-card .col-stepper .step-btn.sm:last-of-type');
await page.waitForTimeout(120);
const plusDisabled = await page.isEnabled('.topic-card .col-stepper .step-btn.sm:last-of-type');
check('E: + disabled while the board is full', plusDisabled === false);
const addVisible = await page.isVisible('#add-topic-btn');
check('E: + ADD TOPIC stays available for more topics', addVisible);
await addTopic('Science', 'Solar System');
const meterE = (await page.textContent('#columns-meter')).replace(/\s+/g, ' ').trim();
const colsE = await page.$$eval('.col-count', nodes => nodes.map(node => node.textContent));
check('E: adding a topic redistributes 2/2', meterE.includes('4 / 4') && JSON.stringify(colsE) === JSON.stringify(['2', '2']), `${meterE} :: ${colsE.join(',')}`);
await page.click('.topic-card:nth-child(1) .col-stepper .step-btn.sm:first-of-type');
await page.waitForTimeout(120);
const meterE2 = (await page.textContent('#columns-meter')).replace(/\s+/g, ' ').trim();
check('E: reducing one topic frees a column', meterE2.includes('3 / 4'), meterE2);

/* ─────────── TEST F: not enough questions ─────────── */
await fresh();
await setBoard(4, 6);
await addSubtopic('Entertainment', 'Celebrities', 'Taylor Swift & Pop Stars');
const createF = await page.isEnabled('#gen-btn');
const meterF = (await page.textContent('#columns-meter')).replace(/\s+/g, ' ').trim();
const plusF = await page.isEnabled('.topic-card .col-stepper .step-btn.sm:last-of-type');
check('F: narrow subtopic is clamped and CREATE stays off', !createF && !plusF && meterF.includes('1 / 4'), meterF);
await page.evaluate(() => {
  localStorage.setItem('jamboo_config', JSON.stringify({
    _keepTeams: true, numTeams: 2, numCols: 4, numRows: 6, difficulty: 'mixed', lang: 'en',
    teams: [{ name: 'A' }, { name: 'B' }],
    topics: [{ topicId: 'celebrities::pop-stars', columns: 4 }],
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.topic-card');
const statusF = (await page.textContent('#build-status')).trim();
const createF2 = await page.isEnabled('#gen-btn');
check('F: oversized restored allocation explains the limit', !createF2 && statusF.includes('8'), statusF);

/* ─────────── TEST C: four different topics ─────────── */
await fresh();
await setBoard(4, 5);
await addTopic('Mathematics', 'Fractions');
await addTopic('Mathematics', 'Area & Perimeter');
await addTopic('Science', 'Cells');
await addTopic('Entertainment', 'Video Games');
await page.click('#gen-btn');
await page.waitForURL('**/game.html', { timeout: 10000 });
await page.waitForSelector('#game-wrap.ready', { timeout: 10000 });
const sessionC = await page.evaluate(() => JSON.parse(localStorage.getItem('jamboo_config')).session);
check('C: one column per topic', JSON.stringify(sessionC.columnTopics) === JSON.stringify(['fractions', 'area-perimeter', 'cells', 'video-games']), sessionC.columnTopics.join(','));
check('C: 5 questions from each topic', sessionC.questions.every(column => column.length === 5));

/* ─────────── TEST I: tablet + phone layout ─────────── */
for (const viewport of [{ width: 768, height: 1024, name: 'iPad portrait' }, { width: 1024, height: 768, name: 'iPad landscape' }, { width: 390, height: 844, name: 'phone' }]) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await fresh();
  await setBoard(4, 5);
  await page.click('#add-topic-btn');
  await page.waitForSelector('.miller-item');
  const overflowPicker = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const panelBox = await page.locator('.picker-panel').boundingBox();
  check(`I:${viewport.name} picker fits viewport`, overflowPicker <= 1 && panelBox.width <= viewport.width + 1, `overflow=${overflowPicker}px panel=${Math.round(panelBox.width)}px`);
  await page.click('.miller-item:has-text("Mathematics")');
  await page.waitForTimeout(120);
  await page.click('.miller-item:has-text("Fractions")');
  await page.waitForTimeout(150);
  await page.click('.miller-all');
  await page.waitForTimeout(150);
  const overflowBuilder = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`I:${viewport.name} builder has no horizontal overflow`, overflowBuilder <= 1, `overflow=${overflowBuilder}px`);
  if (viewport.name === 'iPad portrait') {
    await page.screenshot({ path: `${SHOT}/builder-ipad.png` , fullPage: true });
  }
}

/* ─────────── search inside the picker ─────────── */
await page.setViewportSize({ width: 1280, height: 950 });
await fresh();
await page.click('#add-topic-btn');
await page.fill('#picker-search', 'fraction');
await page.waitForTimeout(200);
const searchResults = await page.$$eval('.picker-item .pi-name', nodes => nodes.map(node => node.textContent));
check('Search finds repository topics', searchResults.includes('Fractions'), searchResults.join(','));
await page.fill('#picker-search', 'solar');
await page.waitForTimeout(200);
const results2 = await page.$$eval('.picker-item .pi-name', nodes => nodes.map(node => node.textContent));
check('Search finds Solar System', results2.includes('Solar System'), results2.join(','));
await page.fill('#picker-search', 'taylor swift');
await page.waitForTimeout(250);
const results3 = await page.$$eval('.picker-item .pi-name', nodes => nodes.map(node => node.textContent));
check('Search finds the Taylor Swift subtopic', results3.some(name => name.includes('Taylor Swift')), results3.join(','));
await page.fill('#picker-search', 'minecraft');
await page.waitForTimeout(250);
const results4 = await page.$$eval('.picker-item .pi-name', nodes => nodes.map(node => node.textContent));
check('Search finds the Minecraft subtopic', results4.includes('Minecraft'), results4.join(','));
await page.keyboard.press('Escape');
const pickerClosed = await page.isHidden('#picker-overlay');
check('Escape closes the picker', pickerClosed);

/* ─────────── TEST K: reorder, change and remove topics ─────────── */
await fresh();
await setBoard(4, 5);
await addTopic('Mathematics', 'Fractions');
await addTopic('Science', 'Solar System');
await page.click('.topic-card:nth-child(2) .topic-actions .mini-btn:nth-child(1)');
await page.waitForTimeout(150);
const reordered = await page.$$eval('.bp-head', nodes => nodes.map(node => node.textContent));
check('K: move left reorders board columns', JSON.stringify(reordered) === JSON.stringify(['Solar System I', 'Solar System II', 'Fractions I', 'Fractions II']), reordered.join(' | '));
await page.click('.topic-card:nth-child(1) .topic-actions .mini-btn:nth-child(3)');
await page.waitForSelector('.miller-item');
await page.click('.miller-item:has-text("Science")');
await page.waitForTimeout(120);
await page.click('.miller-item:has-text("Cells")');
await page.waitForTimeout(150);
await page.click('.miller-all');
await page.waitForTimeout(200);
const changed = await page.textContent('.topic-card:nth-child(1) .topic-name');
const changedCols = await page.textContent('.topic-card:nth-child(1) .col-count');
check('K: change topic keeps its columns', changed === 'Cells' && changedCols === '2', `${changed} x${changedCols}`);
await page.click('.topic-card:nth-child(2) .topic-actions .mini-btn:nth-child(4)');
await page.waitForTimeout(200);
const meterK = (await page.textContent('#columns-meter')).replace(/\s+/g, ' ').trim();
const createK = await page.isEnabled('#gen-btn');
check('K: removing a topic frees its columns', !createK && meterK.includes('2 / 4'), meterK);

/* ─────────── TEST L: subtopic-specific quizzes ─────────── */
await fresh();
await setBoard(4, 4);
await addSubtopic('Entertainment', 'Video Games', 'Minecraft');
await addSubtopic('Entertainment', 'Celebrities', 'Taylor Swift & Pop Stars');
const subtopicPaths = await page.$$eval('.topic-path', nodes => nodes.map(node => node.textContent));
check('L: subtopic cards show their parent topic', JSON.stringify(subtopicPaths) === JSON.stringify(['Video Games', 'Celebrities']), subtopicPaths.join(' | '));
const subtopicMeter = (await page.textContent('#columns-meter')).replace(/\s+/g, ' ').trim();
check('L: two subtopics split the board', subtopicMeter.includes('4 / 4'), subtopicMeter);
await page.click('#gen-btn');
await page.waitForURL('**/game.html', { timeout: 10000 });
await page.waitForSelector('#game-wrap.ready', { timeout: 10000 });
const sessionL = await page.evaluate(() => JSON.parse(localStorage.getItem('jamboo_config')).session);
check('L: subtopic board labels', JSON.stringify(sessionL.categories) === JSON.stringify(['Minecraft I', 'Minecraft II', 'Taylor Swift & Pop Stars I', 'Taylor Swift & Pop Stars II']), sessionL.categories.join(' | '));
const minecraftColumns = sessionL.questions[0].concat(sessionL.questions[1]);
const popColumns = sessionL.questions[2].concat(sessionL.questions[3]);
check('L: Minecraft columns only use Minecraft questions', minecraftColumns.every(question => question.subtopic === 'minecraft'));
check('L: pop-star columns only use pop-star questions', popColumns.every(question => question.subtopic === 'pop-stars'));
check('L: no repeated question across subtopic columns', new Set(sessionL.questionIds).size === 16);

/* ─────────── Same teams, new game round trip ─────────── */
await fresh();
await setBoard(4, 5);
await addTopic('Mathematics', 'Fractions');
await page.click('#gen-btn');
await page.waitForURL('**/game.html', { timeout: 10000 });
await page.waitForSelector('#game-wrap.ready', { timeout: 10000 });
await page.evaluate(() => { document.getElementById('winner-screen').classList.add('active'); });
await page.click('#lbl-same-teams');
await page.waitForURL('**/index.html', { timeout: 10000 });
await page.waitForSelector('#add-topic-btn');
await page.waitForTimeout(250);
const restoredTopic = await page.textContent('.topic-name');
const restoredCols = await page.textContent('.col-count');
check('Same Teams restores the selected topic', restoredTopic === 'Fractions' && restoredCols === '4', `${restoredTopic} x${restoredCols}`);

/* ─────────── language switch stays localised ─────────── */
await page.click('#burger-btn');
await page.click('#lang-pt');
await page.waitForTimeout(200);
const ptTitle = await page.textContent('#page-title');
const ptAdd = await page.textContent('#add-topic-btn');
check('Language switch localises the builder', ptTitle === 'CRIE UM JAMBOO' && ptAdd.includes('ADICIONAR'), `${ptTitle} / ${ptAdd}`);

check('No page errors during the run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
check('No /api calls during builder or gameplay', apiCalls.length === 0, apiCalls.join(','));

await browser.close();
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
