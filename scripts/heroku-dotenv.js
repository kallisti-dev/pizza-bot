
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
var exec = require('child_process').exec;

const quoteRegex = /"/g;

function main() {
    const dotEnvFile = path.resolve(process.cwd(), process.argv[2] || '.env');
    console.log(`Reading config from ${dotEnvFile}`);
    const env = dotenv.parse(Buffer.from(fs.readFileSync(dotEnvFile)));
    console.log(`Pushing config to heroku...`);
    const cmdArgs = Object.entries(env).map(([key, value]) =>
        `"${key}=${value.replace(quoteRegex, '\\"')}"`
    );
    exec(`heroku config:set ${cmdArgs.join(' ')}`, (err, stdout, stderr) => {
        if(err) console.error(err);
        if(stdout) console.log(stdout);
        if(stderr) console.error(stderr);
        if(err || stderr) process.exit(1);
        process.exit(0);
    });
}
main();