import re

with open('backend/db.js', 'r') as f:
    content = f.read()

# 1. Update runQuery definition
content = content.replace(
    'async function runQuery(text, params = [], retryCount = 1) {',
    'async function runQuery(text, params = [], client = null, retryCount = 1) {'
)
content = content.replace(
    'const res = await pool.query(text, params);',
    'const res = client ? await client.query(text, params) : await pool.query(text, params);'
)
content = content.replace(
    'return runQuery(text, params, retryCount - 1);',
    'return runQuery(text, params, client, retryCount - 1);'
)

# Replace all runQuery calls within syncToPostgres
start_idx = content.find('function syncToPostgres()')
end_idx = content.find('function handleGracefulShutdown', start_idx)

sub_content = content[start_idx:end_idx]
# Match await runQuery(`...`, [...])
sub_content = re.sub(r'await runQuery\((`.*?`),\s*(\[.*?\])\)', r'await runQuery(\1, \2, client)', sub_content, flags=re.DOTALL)
# Match await runQuery(payloadParams.query, payloadParams.args)
sub_content = sub_content.replace('await runQuery(payloadParams.query, payloadParams.args)', 'await runQuery(payloadParams.query, payloadParams.args, client)')

content = content[:start_idx] + sub_content + content[end_idx:]

with open('backend/db.js', 'w') as f:
    f.write(content)

