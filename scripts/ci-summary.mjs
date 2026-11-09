// Prints a Markdown summary of reports/playwright-results.json for $GITHUB_STEP_SUMMARY.
import { existsSync, readFileSync } from 'node:fs';

const file = 'reports/playwright-results.json';
if (!existsSync(file)) {
  console.log('### Smoke tests\n\nNo Playwright results file was produced.');
  process.exit(0);
}

const report = JSON.parse(readFileSync(file, 'utf8'));
const rows = [];
const walk = (suite, trail = []) => {
  const path = suite.title && !suite.title.endsWith('.ts') ? [...trail, suite.title] : trail;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const icon = { expected: '✅', unexpected: '❌', flaky: '⚠️', skipped: '⏭️' }[t.status] ?? '❔';
      const ms = t.results.reduce((s, r) => s + r.duration, 0);
      const err = t.status === 'unexpected' ? (t.results.at(-1)?.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0].slice(0, 120) : '';
      rows.push(`| ${icon} | ${t.projectName} | ${[...path, spec.title].join(' › ').replaceAll('|', '\\|')} | ${(ms / 1000).toFixed(1)}s | ${err.replaceAll('|', '\\|')} |`);
    }
  }
  for (const child of suite.suites ?? []) walk(child, path);
};
report.suites.forEach(s => walk(s));

const st = report.stats ?? {};
console.log(`### Smoke tests: ${st.unexpected ? '❌ FAILED' : '✅ PASSED'}

| Passed | Failed | Flaky | Skipped | Duration |
|---|---|---|---|---|
| ${st.expected ?? 0} | ${st.unexpected ?? 0} | ${st.flaky ?? 0} | ${st.skipped ?? 0} | ${((st.duration ?? 0) / 1000).toFixed(1)}s |

| | Project | Test | Time | Error |
|---|---|---|---|---|
${rows.join('\n')}

Full HTML report: download the **smoke-report** artifact below.`);
