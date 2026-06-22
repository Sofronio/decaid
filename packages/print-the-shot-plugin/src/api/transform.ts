/**
 * Transforms the Decent.app REST API shot format into the TCL ::shot::create
 * format that the Print The Shot server (ESP32) expects.
 *
 * REST format:  { id, timestamp, measurements: [{machine, scale, volume}], workflow, annotations }
 * TCL format:   { version, clock, elapsed, pressure, flow, temperature, totals, profile, meta, ... }
 */

export const transformScript = `
function restToTcl(shot) {
  const ms = shot.measurements || [];
  const profile = shot.workflow?.profile || {};
  const annotations = shot.annotations || {};
  const context = shot.workflow?.context || {};

  // Timestamps
  const now = Math.floor(Date.now() / 1000);
  const clock = String(now);
  const dateStr = new Date().toString();

  const elapsed = [];
  const pressureArr = [];
  const pressureGoal = [];
  const flowArr = [];
  const flowByWeight = [];
  const flowGoal = [];
  const basketTemp = [];
  const mixTemp = [];
  const tempGoal = [];
  const weightArr = [];
  const waterDispensed = [];
  const resistanceArr = [];
  const resistanceByWeight = [];
  const stateChange = [];

  // ── Deduplicate & extract ──
  // REST measurements pair machine readings (~100ms) with scale readings
  // (~200ms).  Two consecutive machine entries share one scale reading.
  // Deduplicate by tracking the composite key (timer + weight) and
  // keeping the LAST machine entry for each unique scale snapshot.
  var lastKey = null;
  var firstTimer = null;
  var lastGoodTimer = null;

  // Buffer: hold the previous (key, values) until the key changes, then emit.
  var bufM = null;
  var bufKey = null;

  function emitPoint(m, s, mc) {
    var timer = s.timerValue;
    if (timer != null && firstTimer == null) firstTimer = timer;
    if (timer != null) lastGoodTimer = timer;
    var useTimer = timer != null ? timer : (lastGoodTimer != null ? lastGoodTimer : 0);
    var elapsedSec = firstTimer != null
      ? ((useTimer - firstTimer) / 1000).toFixed(3)
      : (0).toFixed(3);

    elapsed.push(elapsedSec);
    pressureArr.push(mc.pressure != null ? mc.pressure.toFixed(2) : "0.0");
    pressureGoal.push(mc.targetPressure != null ? mc.targetPressure.toFixed(2) : "-1.0");
    flowArr.push(m.volume != null ? m.volume.toFixed(2) : (mc.flow != null ? mc.flow.toFixed(2) : "0.0"));
    flowByWeight.push("0.0");
    flowGoal.push(mc.targetFlow != null ? mc.targetFlow.toFixed(2) : "-1.0");
    basketTemp.push(mc.groupTemperature != null ? mc.groupTemperature.toFixed(2) : "0.0");
    mixTemp.push(mc.mixTemperature != null ? mc.mixTemperature.toFixed(2) : "0.0");
    tempGoal.push(mc.targetGroupTemperature != null ? mc.targetGroupTemperature.toFixed(2) : "0.0");
    weightArr.push(s.weight != null ? s.weight.toFixed(1) : "0.0");
    waterDispensed.push("0.0");
    resistanceArr.push("0.0");
    resistanceByWeight.push("0.0");
    stateChange.push("10000000.0");
  }

  for (var i = 0; i < ms.length; i++) {
    var m = ms[i];
    var s = m.scale || {};
    var mc = m.machine || {};

    // Build a composite key from timer + weight (same reading = same timer & weight)
    var key = (s.timerValue != null ? s.timerValue : '~') + '|' + (s.weight != null ? s.weight.toFixed(3) : '~');
    if (bufKey != null && key !== bufKey) {
      // Scale reading changed → emit the buffered point
      emitPoint(bufM, bufM.scale || {}, bufM.machine || {});
    }
    // Buffer latest machine entry for this scale snapshot
    bufM = m;
    bufKey = key;
  }
  // Emit the final point
  if (bufM != null) {
    emitPoint(bufM, bufM.scale || {}, bufM.machine || {});
  }

  // ── Profile ──
  // Map exit value to TCL format: keep as-is if already an object/number
  var steps = (profile.steps || []).map(function(s) {
    var exitVal = s.exit;
    return {
      name: s.name || "",
      temperature: String(s.temperature || 0),
      sensor: s.sensor || "coffee",
      pump: s.pump || "pressure",
      transition: s.transition || "fast",
      pressure: String(s.pressure || 0),
      flow: String(s.flow || ""),
      seconds: String(s.seconds || 0),
      volume: String(s.volume || 0),
      weight: s.weight != null ? String(s.weight) : "0",
      exit: exitVal
    };
  });

  var tclProfile = {
    title: profile.title || "Default",
    author: profile.author || "Decent",
    notes: profile.notes || "",
    beverage_type: profile.beverage_type || "espresso",
    tank_temperature: String(profile.tank_temperature || 0),
    target_weight: annotations.actualYield != null ? String(Math.round(annotations.actualYield)) : "0",
    target_volume: String(profile.target_volume || profile.target_weight || "0"),
    target_volume_count_start: String(profile.target_volume_count_start || 0),
    version: "2",
    type: "pressure",
    lang: "en",
    hidden: "0",
    steps: steps
  };

  // ── Meta ──
  var meta = {
    bean: {
      brand: context.beanBrand || "",
      type: context.beanType || "",
      notes: "",
      roast_level: context.roastLevel || "",
      roast_date: context.roastDate || ""
    },
    shot: {
      enjoyment: "0",
      notes: "",
      tds: "0",
      ey: "0"
    },
    grinder: {
      model: context.grinderModel || "",
      setting: context.grinderSetting || ""
    },
    in: annotations.actualDoseWeight != null ? String(annotations.actualDoseWeight) : "0",
    out: annotations.actualYield != null ? String(annotations.actualYield) : "0",
    time: elapsed.length > 0 ? elapsed[elapsed.length - 1] : "0"
  };

  return {
    version: "2",
    clock: clock,
    date: dateStr,
    timestamp: clock,
    elapsed: elapsed,
    timers: {},
    pressure: { pressure: pressureArr, goal: pressureGoal },
    flow: { flow: flowArr, by_weight: flowByWeight, by_weight_raw: flowByWeight, goal: flowGoal },
    temperature: { basket: basketTemp, mix: mixTemp, goal: tempGoal },
    scale: {},
    totals: { weight: weightArr, water_dispensed: waterDispensed },
    resistance: { resistance: resistanceArr, by_weight: resistanceByWeight },
    state_change: stateChange,
    profile: tclProfile,
    meta: meta,
    app: { app_name: "Decent.app", app_version: "1.0.0", data: {} }
  };
}
`;
