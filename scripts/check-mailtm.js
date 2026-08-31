require('dotenv').config();
const { getDomains } = require('../lib/provider');
(async () => {
  try {
    const domains = await getDomains();
    console.log(`Mail.tm API OK — usable domains: ${domains.length}`);
    for (const d of domains.slice(0, 20)) console.log(`- ${d.domain} | active=${d.isActive} | private=${d.isPrivate}`);
    if (!domains.length) {
      console.error('No usable domains were returned by GET /domains.');
      process.exit(2);
    }
    process.exit(0);
  } catch (error) {
    console.error(`Mail.tm API ERROR: ${error.message}`);
    process.exit(1);
  }
})();
