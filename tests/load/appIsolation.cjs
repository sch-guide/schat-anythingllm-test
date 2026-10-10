const fs = require('node:fs');
function assertIsolation() {
  if (!fs.existsSync('/.dockerenv')) throw Error('Docker required');
  const routes = fs.readFileSync('/proc/net/route', 'utf8');
  if (routes.split('\n').slice(1).some(line => line.trim().split(/\s+/)[1] === '00000000'))
    throw Error('External network route is forbidden');
  const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  if (!mounts.split('\n').some(line => line.split(' ')[4] === '/app/server/storage' && line.includes(' - tmpfs ')))
    throw Error('Fresh tmpfs storage required; never mount existing data');
  if (process.env.SCHAT_ISOLATED_APP_TEST !== 'explicit-local-only') throw Error('Explicit test invocation required');
}
module.exports = {assertIsolation};
