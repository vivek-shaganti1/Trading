import re

with open('frontend/dashboard.js', 'r') as f:
    content = f.read()

old_fn = r"""window\.inspectFunnelStage = function\(stageName, count\) \{.*?^\};"""
new_fn = """window.inspectFunnelStage = function(stageName, count) {
  const modal = document.getElementById('rejected-candidates-modal');
  const modalBody = document.getElementById('rejected-candidates-list');
  
  modal.classList.add('active');

  const rejections = window._lastStatusData && window._lastStatusData.runtime
    ? (window._lastStatusData.runtime.funnel || {}).last_rejected || []
    : [];

  // Loosen strict filter so we always show reasons if specific stage matching fails
  let stageRejections = rejections.filter(r => (r.stage || '').includes(stageName) || stageName.includes(r.stage));
  if (stageRejections.length === 0 && rejections.length > 0) {
    stageRejections = rejections.slice(0, 5); // Show latest 5 as fallback
  }

  const list = stageRejections.length > 0
    ? stageRejections.map(r => `<strong>${r.symbol || 'Unknown'}</strong>: ${r.reason || 'Rejected'} <br><small>Agent: ${r.agent || 'System'} | Time: ${r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '--'}</small>`)
    : ['No rejection data logged in current run.'];

  modalBody.innerHTML = `
    <h4 style="margin-bottom: 10px; color: var(--accent-blue);">Recent Failed Candidates</h4>
    <ul style="padding-left: 15px; font-size: 0.75rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 8px;">
      ${list.map(item => `<li style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">${item}</li>`).join('')}
    </ul>
  `;
};"""

content = re.sub(old_fn, new_fn, content, flags=re.DOTALL|re.MULTILINE)

with open('frontend/dashboard.js', 'w') as f:
    f.write(content)

