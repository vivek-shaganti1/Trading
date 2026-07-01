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

# 2. Modify syncToPostgres
# Find the start of syncToPostgres
match = re.search(r'async function syncToPostgres\(\) \{.*?(try \{.*?const data = readLocalDb\(\);)', content, re.DOTALL)
if match:
    old_start = match.group(1)
    new_start = '''let client = null;
  if (pool) {
    try {
      client = await pool.connect();
      await client.query('BEGIN');
    } catch (e) {
      console.error('[DB SYNC] Failed to start transaction', e);
      syncInProgress = false;
      return;
    }
  }

  try {
    const data = readLocalDb();'''
    content = content.replace(old_start, new_start)

# Add client to runQuery calls inside syncToPostgres
# It's tricky to do it purely with regex because runQuery is used everywhere. 
# We'll replace it only within syncToPostgres
start_idx = content.find('function syncToPostgres')
end_idx = content.find('function handleGracefulShutdown', start_idx)

sub_content = content[start_idx:end_idx]
sub_content = re.sub(r'await runQuery\((.*?),\s*\[(.*?)\]\)', r'await runQuery(\1, [\2], client)', sub_content, flags=re.DOTALL)
sub_content = sub_content.replace('await runQuery(payloadParams.query, payloadParams.args)', 'await runQuery(payloadParams.query, payloadParams.args, client)')

# Add COMMIT and ROLLBACK to syncToPostgres try/catch
sub_content = sub_content.replace('writeLocalDb(data);', "writeLocalDb(data);\n    if (client) await client.query('COMMIT');")
sub_content = sub_content.replace("console.error('[DB SYNC]: Error during Neon sync:', err);", "if (client) await client.query('ROLLBACK');\n    console.error('[DB SYNC]: Error during Neon sync:', err);")
sub_content = sub_content.replace("syncInProgress = false;", "if (client) client.release();\n    syncInProgress = false;")

content = content[:start_idx] + sub_content + content[end_idx:]

with open('backend/db.js', 'w') as f:
    f.write(content)

