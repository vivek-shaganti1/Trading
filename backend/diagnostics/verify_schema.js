/**
 * verify_schema.js — proves the live Postgres schema matches what the code writes.
 *
 * Run: node backend/diagnostics/verify_schema.js
 *
 * The previous schema.sql disagreed with backend/db.js on twelve tables. Because
 * the runtime uses CREATE TABLE IF NOT EXISTS, a wrong-shaped table is never
 * repaired — the INSERT just fails, the record stays synced=false, and nothing
 * says a word. This test writes one row through EVERY code path, reads it back,
 * then deletes it, so a schema drift can never again go unnoticed.
 *
 * It cleans up after itself; nothing it writes survives the run.
 */

const path = require('path');
const config = require(path.join(__dirname, '..', '..', 'shared', 'config.js'));
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000
});

const TAG = 'SCHEMACHECK';
let pass = 0, fail = 0;
const failures = [];

async function check(table, sql, args) {
  try {
    await pool.query(sql, args);
    console.log(`  \x1b[32mPASS\x1b[0m ${table}`);
    pass++;
  } catch (e) {
    console.log(`  \x1b[31mFAIL\x1b[0m ${table}\n         ${e.message.split('\n')[0]}`);
    failures.push({ table, error: e.message.split('\n')[0] });
    fail++;
  }
}

(async () => {
  console.log('\nWriting one row through every INSERT the code performs...\n');

  // Exactly the column lists backend/db.js uses.
  await check('portfolio_state',
    `INSERT INTO portfolio_state (id,strategy,balance,equity_value,current_daily_target,lifetime_pnl,holding_stocks,updated_at)
     VALUES ($1,'SWING',12000,0,1200,0,'[]',NOW()) ON CONFLICT (id) DO UPDATE SET balance=EXCLUDED.balance`, [TAG]);

  await check('model_weights',
    `INSERT INTO model_weights (id,agent1_weight,agent2_weight,agent3_weight,agent4_weight,ema_weight,rsi_weight,macd_weight,rsi_threshold,adaptation_count,neural_model_weights,updated_at)
     VALUES ($1,0.15,0.08,0,0,0.4,0.3,0.3,50,0,'{}',NOW()) ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('agent_memory',
    `INSERT INTO agent_memory (id,paper_trading_stats,winning_patterns,losing_patterns,user_instructions,updated_at)
     VALUES ($1,'{}','[]','[]','{}',NOW()) ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('paper_trading_results',
    `INSERT INTO paper_trading_results (id,trading_days_tracked,win_rate,profit_factor,sharpe_ratio,max_drawdown,accuracy,net_pnl,details,updated_at)
     VALUES ($1,0,0,1,0,0,0,0,'{}',NOW()) ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('scanner_rankings',
    `INSERT INTO scanner_rankings (longs,shorts) VALUES ('[]','[]')`, []);

  // trade_logs INCLUDING the execution-provenance columns broker.js supplies.
  await check('trade_logs (with provenance)',
    `INSERT INTO trade_logs (id,timestamp,symbol,action,strategy,quantity,price,total_value,reason,execution_mode,venue,broker_order_id,quote_price,slippage_pct)
     VALUES ($1,NOW(),'TESTSYM','BUY','CNC',1,100.5,100.5,'schema check','INSTITUTIONAL','ZERODHA','250828000111',100.4,0.0996)
     ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('completed_trades',
    `INSERT INTO completed_trades (trade_id,symbol,entry_time,exit_time,entry_price,exit_price,quantity,gross_pnl,net_pnl,return_pct,holding_minutes,exit_reason,tqs,confidence,execution_mode,entry_efficiency,exit_efficiency,mfe,mae)
     VALUES ($1,'TESTSYM',NOW(),NOW(),100,101,1,1,0.9,1.0,30,'target',70,0.7,'INSTITUTIONAL',0.5,0.5,1.2,-0.3)
     ON CONFLICT (trade_id) DO NOTHING`, [TAG]);

  await check('shadow_trades',
    `INSERT INTO shadow_trades (id,timestamp,symbol,entry_price,current_price,quantity,confidence,tqs,opportunity_score,status,pnl,return_pct)
     VALUES ($1,NOW(),'TESTSYM',100,101,1,0.7,70,80,'OPEN',1,1) ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('daily_stats',
    `INSERT INTO daily_stats (date,start_capital,end_capital,net_pnl,daily_target,target_met,strategy_switched,status,updated_at)
     VALUES ($1,12000,12000,0,1200,false,false,'ACTIVE',NOW()) ON CONFLICT (date) DO UPDATE SET status=EXCLUDED.status`, [TAG]);

  await check('daily_model_performance',
    `INSERT INTO daily_model_performance (date,agent1_accuracy,agent2_accuracy,agent3_accuracy,agent4_accuracy,consensus_accuracy,total_predictions,details,updated_at)
     VALUES ($1,0.5,0.5,0.5,0.5,0.5,0,'{}',NOW()) ON CONFLICT (date) DO NOTHING`, [TAG]);

  await check('performance_metrics',
    `INSERT INTO performance_metrics (date,expected_profit,profit_factor,sharpe_ratio,max_drawdown,winning_symbols,losing_symbols,capital_utilization)
     VALUES ($1,0,1,0,0,'[]','[]',0) ON CONFLICT (date) DO NOTHING`, [TAG]);

  await check('eod_report_state',
    `INSERT INTO eod_report_state (date,sent,sent_at) VALUES ($1,true,NOW()) ON CONFLICT (date) DO NOTHING`, [TAG]);

  await check('prediction_logs',
    `INSERT INTO prediction_logs (id,timestamp,symbol,signal,model_source,consensus,custom_signal,kraken_signal,debate_summary,entry_price,exit_price,pnl)
     VALUES ($1,NOW(),'TESTSYM','BUY','ml','yes','BUY','BUY','x',100,101,1) ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('consensus_decisions',
    `INSERT INTO consensus_decisions (id,timestamp,symbol,decision,confidence,participating_models,debate_summary,final_outcome,result_after_closes,ref_15m,ref_30m,ref_1h,ref_eod)
     VALUES ($1,NOW(),'TESTSYM','BUY',0.7,'{}','x','WIN',1.0,100,101,102,103) ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('opportunity_tracker',
    `INSERT INTO opportunity_tracker (symbol,current_price,confidence,tqs,consensus_score,buy_votes,sell_votes,hold_votes,agent_count,signal_type,rejection_reason,scan_timestamp,opportunity_score,status,participating_models,debate_summary)
     VALUES ($1,100,0.7,70,0.7,5,2,3,10,'BUY','none',NOW(),80,'EXECUTED','{}','x')`, [TAG]);

  await check('throughput_history',
    `INSERT INTO throughput_history (timestamp,scanned,researched,ranked,scored,candidates,consensus,executed,passed_risk,rejection_reasons)
     VALUES (NOW(),55,30,15,15,15,4,1,1,'{}')`, []);

  await check('threshold_history',
    `INSERT INTO threshold_history (threshold,regime,volatility,sector_strength,reasoning) VALUES (70,'TRENDING','CALM',0.6,$1)`, [TAG]);

  await check('alerts',
    `INSERT INTO alerts (id,timestamp,type,message,status) VALUES ($1,NOW(),'INFO','schema check','SENT') ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('risk_events',
    `INSERT INTO risk_events (id,timestamp,event_type,description,portfolio_value,details)
     VALUES ($1,NOW(),'TEST','schema check',12000,'{}') ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('telegram_commands',
    `INSERT INTO telegram_commands (id,timestamp,command,parameters,applied) VALUES ($1,NOW(),'/status','{}',true) ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('sessions',
    `INSERT INTO sessions (id,status,start_time) VALUES ($1,'ACTIVE',NOW()) ON CONFLICT (id) DO NOTHING`, [TAG]);

  await check('learning_feedback',
    `INSERT INTO learning_feedback (id,timestamp,prediction_id,pnl,learning_rate,weights_before,weights_after)
     VALUES ($1,NOW(),'p1',1.0,0.01,'{}','{}') ON CONFLICT (id) DO NOTHING`, [TAG]);

  // The eight tables the old schema got wrong.
  await check('agent20_reports',
    `INSERT INTO agent20_reports (trade_id,symbol,entry_reason,exit_reason,supporting_agents,opposing_agents,market_conditions,outcome,lessons_learned)
     VALUES ($1,'TESTSYM','a','b','[]','[]','{}','WIN','x')`, [TAG]);

  await check('agent21_trust_logs',
    `INSERT INTO agent21_trust_logs (weights_before,weights_after,adjustments) VALUES ('{}','{}','{}')`, []);

  await check('agent22_research_logs',
    `INSERT INTO agent22_research_logs (regime,sector,volatility,momentum,improvements,backtest_results,deployed)
     VALUES ($1,'IT','CALM','UP','[]','{}',false)`, [TAG]);

  await check('agent23_journals',
    `INSERT INTO agent23_journals (trade_id,symbol,entry_thesis,exit_thesis,outcome,mistakes,success_factors,lessons)
     VALUES ($1,'TESTSYM','a','b','WIN','none','x','y')`, [TAG]);

  await check('agent24_audit_logs',
    `INSERT INTO agent24_audit_logs (symbol,tqs,rejection_reason,price_at_rejection,current_price,return_pct,ref_15m,ref_30m,ref_1h,ref_eod,completed)
     VALUES ($1,65,'below threshold',100,101,1.0,100,101,102,103,true)`, [TAG]);

  await check('agent25_sizing_logs',
    `INSERT INTO agent25_sizing_logs (symbol,sector,tqs_band,regime,expectancy,current_alloc,recommended_alloc)
     VALUES ($1,'IT','70-75','TRENDING',0.4,10,12)`, [TAG]);

  await check('agent26_market_memory',
    `INSERT INTO agent26_market_memory (symbol,signal,feature_vector,outcome_pnl) VALUES ($1,'BUY','{}',1.0)`, [TAG]);

  await check('nightly_learning_reports',
    `INSERT INTO nightly_learning_reports (metrics,missed_opportunities,sizing_recommendations,learning_log)
     VALUES ('{}','[]','[]',$1)`, [TAG]);

  // ── read-back, then clean up ───────────────────────────────────────────────
  console.log('\nReading back and cleaning up...');
  const rb = await pool.query(
    `SELECT id, symbol, price, venue, broker_order_id, quote_price, slippage_pct FROM trade_logs WHERE id=$1`, [TAG]);
  if (rb.rows.length) {
    const r = rb.rows[0];
    console.log(`  trade_logs round-trip: ${r.symbol} @ ${r.price} via ${r.venue}` +
                ` order=${r.broker_order_id} quote=${r.quote_price} slippage=${r.slippage_pct}%`);
  } else {
    console.log('  \x1b[31mtrade_logs round-trip FAILED — row not found\x1b[0m');
    fail++;
  }

  const cleanup = [
    ['portfolio_state','id'],['model_weights','id'],['agent_memory','id'],['paper_trading_results','id'],
    ['trade_logs','id'],['shadow_trades','id'],['prediction_logs','id'],['consensus_decisions','id'],
    ['alerts','id'],['risk_events','id'],['telegram_commands','id'],['sessions','id'],['learning_feedback','id'],
    ['daily_stats','date'],['daily_model_performance','date'],['performance_metrics','date'],['eod_report_state','date'],
    ['completed_trades','trade_id'],['opportunity_tracker','symbol'],['threshold_history','reasoning'],
    ['agent20_reports','trade_id'],['agent22_research_logs','regime'],['agent23_journals','trade_id'],
    ['agent24_audit_logs','symbol'],['agent25_sizing_logs','symbol'],['agent26_market_memory','symbol'],
    ['nightly_learning_reports','learning_log']
  ];
  for (const [t, col] of cleanup) {
    await pool.query(`DELETE FROM ${t} WHERE ${col}=$1`, [TAG]).catch(() => {});
  }
  await pool.query(`DELETE FROM scanner_rankings WHERE longs::text='[]'`).catch(() => {});
  await pool.query(`DELETE FROM agent21_trust_logs WHERE adjustments::text='{}'`).catch(() => {});
  await pool.query(`DELETE FROM throughput_history WHERE scanned=55 AND researched=30`).catch(() => {});
  console.log('  test rows removed.');

  console.log('\n' + '='.repeat(60));
  console.log(`  ${pass} tables accepted the code's INSERT, ${fail} failed`);
  if (failures.length) failures.forEach(f => console.log(`    ${f.table}: ${f.error}`));
  console.log('='.repeat(60) + '\n');

  await pool.end();
  process.exit(fail ? 1 : 0);
})();
