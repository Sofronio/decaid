export function toTclFormat(shot: Record<string, unknown>): Record<string, unknown> {
  const ms = (shot.measurements as Array<Record<string, any>>) || [];
  const elapsed: string[] = [];
  const pressure: string[] = [];
  const pressureGoal: string[] = [];
  const flow: string[] = [];
  const flowByWeight: string[] = [];
  const flowGoal: string[] = [];
  const basket: string[] = [];
  const mix: string[] = [];
  const tempGoal: string[] = [];
  const weight: string[] = [];
  const waterDispensed: string[] = [];
  const stateChange: string[] = [];
  let prevState = "";

  // t0 = first preinfusion/pouring point (matches chart's shotStartTime)
  let t0: number | null = null;
  for (const m0 of ms) {
    const ss0 = m0.machine?.state?.substate || "";
    if (ss0 !== "preinfusion" && ss0 !== "pouring") continue;
    const ts0 = m0.machine?.timestamp;
    if (ts0 != null) {
      t0 = new Date(ts0 as string).getTime();
      break;
    }
  }
  if (t0 == null) t0 = 0;

  // Weight smoothing state (matching chart's SMOOTHING_FACTOR = 0.1)
  let lastScaleWeight = 0;
  let lastScaleTime = 0;
  let smoothedWeightChange = 0;

  for (const item of ms) {
    const m = item.machine || {};
    const ss = m.state?.substate || "";
    if (ss !== "preinfusion" && ss !== "pouring") continue;

    const s = item.scale || {};

    const mts = m.timestamp;
    elapsed.push(mts != null ? ((new Date(mts as string).getTime() - t0!) / 1000).toFixed(1) : "0.0");

    pressure.push(m.pressure != null ? (m.pressure as number).toFixed(2) : "0.0");
    pressureGoal.push(m.targetPressure != null ? (m.targetPressure as number).toFixed(2) : "0.0");

    flow.push(m.flow != null ? (m.flow as number).toFixed(2) : "0.0");
    flowGoal.push(m.targetFlow != null ? (m.targetFlow as number).toFixed(2) : "0.0");

    basket.push(m.groupTemperature != null ? (m.groupTemperature as number).toFixed(2) : "0.0");
    mix.push(m.mixTemperature != null ? (m.mixTemperature as number).toFixed(2) : "0.0");
    tempGoal.push(m.targetGroupTemperature != null ? (m.targetGroupTemperature as number).toFixed(2) : "0.0");

    // Weight: smoothed derivative on scale timestamp (chart algorithm, SMOOTHING_FACTOR=0.1)
    let weightChange = 0;
    if (s.weight != null) {
      const scaleTs = s.timestamp;
      if (scaleTs != null) {
        const scaleTime = (new Date(scaleTs as string).getTime() - t0!) / 1000;
        if (lastScaleTime > 0 && scaleTime > lastScaleTime) {
          const timeDiff = scaleTime - lastScaleTime;
          const rawChange = ((s.weight as number) - lastScaleWeight) / timeDiff;
          smoothedWeightChange = 0.1 * rawChange + 0.9 * smoothedWeightChange;
          weightChange = smoothedWeightChange;
        }
        lastScaleWeight = s.weight as number;
        lastScaleTime = scaleTime;
      }
    }
    flowByWeight.push(weightChange.toFixed(2));

    weight.push(s.weight != null ? (s.weight as number).toFixed(1) : "0.0");
    waterDispensed.push(item.volume != null ? (item.volume as number).toFixed(2) : "0.0");

    const currState = (m.state?.state || "") + "/" + (m.state?.substate || "");
    stateChange.push(currState !== prevState ? "10000000.0" : "0.0");
    prevState = currState;
  }

  // Normalize elapsed to start from 0
  if (elapsed.length > 0) {
    const et0 = parseFloat(elapsed[0]);
    for (let j = 0; j < elapsed.length; j++) {
      elapsed[j] = (parseFloat(elapsed[j]) - et0).toFixed(1);
    }
  }

  const wf = (shot.workflow || {}) as Record<string, any>;
  const ctx = wf.context || {};
  const prof = wf.profile || {};
  const ann = (shot.annotations || {}) as Record<string, any>;
  const extras = (shot.extras || {}) as Record<string, any>;
  const scaleData = (shot.scale || {}) as Record<string, any>;

  const beanType =
    ctx.coffeeName ||
    extras.bean_type ||
    extras.beanType ||
    scaleData.beanType ||
    "";
  const beanBrand =
    ctx.coffeeRoaster ||
    extras.bean_brand ||
    extras.beanBrand ||
    extras.roaster ||
    "";

  return {
    version: "2",
    clock: String(Math.floor(Date.now() / 1000)),
    date: new Date().toString(),
    timestamp: String(Math.floor(Date.now() / 1000)),
    elapsed,
    pressure: { pressure, goal: pressureGoal },
    flow: { flow, by_weight: flowByWeight, goal: flowGoal },
    temperature: { basket, mix, goal: tempGoal },
    totals: { weight, water_dispensed: waterDispensed },
    state_change: stateChange,
    profile: {
      title: prof.title || "Default",
      author: prof.author || "Decent",
      notes: prof.notes || "",
      beverage_type: prof.beverage_type || "espresso",
      tank_temperature: "0",
      target_weight: ann.actualYield != null ? String(Math.round(ann.actualYield as number)) : "0",
      target_volume: "0",
      target_volume_count_start: String(prof.target_volume_count_start || 0),
      version: "2",
    },
    meta: {
      bean: {
        brand: beanBrand,
        type: beanType,
        notes: ann.espressoNotes || prof.notes || "",
        roast_level: extras.roast_level || extras.roastLevel || "",
        roast_date: extras.roast_date || extras.roastDate || "",
      },
      shot: { enjoyment: "0", notes: "", tds: "0", ey: "0" },
      grinder: {
        model: ctx.grinderModel || "",
        setting: ctx.grinderSetting || "",
      },
      in: ann.actualDoseWeight != null ? String(ann.actualDoseWeight) : "0",
      out: ann.actualYield != null ? String(ann.actualYield) : "0",
      time: elapsed.length > 0 ? elapsed[elapsed.length - 1] : "0",
    },
    app: { app_name: "Decent.app", app_version: "1.0.0", data: {} },
  };
}

export const transformScript = `window.toTclFormat = (${toTclFormat.toString()});`;
