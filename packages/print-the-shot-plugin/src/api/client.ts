/**
 * REST API client for use in browser-side Web Components.
 * This module is inlined as a string constant for use in served HTML pages.
 */

export const apiClientScript = `
const DecentApi = {
  API_BASE: "/api/v1",

  async getLatestShot() {
    try {
      const res = await fetch(this.API_BASE + "/shots?limit=1");
      if (!res.ok) return null;
      const data = await res.json();
      // API returns { items: [...], total, limit, offset }
      const items = data.items || data;
      return Array.isArray(items) && items.length > 0 ? items[0] : null;
    } catch { return null; }
  },

  async getShot(shotId) {
    try {
      const res = await fetch(this.API_BASE + "/shots/" + shotId);
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  // Compact format without the measurements array (for upload to embedded servers).
  // Matches the TCL ::shot::create format — workflow + annotations + summary only.
  async getCompactShot(shotId) {
    const shot = await this.getShot(shotId);
    if (!shot) return null;
    // Strip measurements to keep payload small (~1KB vs ~70KB)
    const { measurements, ...compact } = shot;
    return compact;
  },

  async getBeverageType() {
    try {
      const res = await fetch(this.API_BASE + "/current-profile");
      if (!res.ok) return "espresso";
      const data = await res.json();
      return data.beverageType || "espresso";
    } catch { return "espresso"; }
  },

  async getShotDuration(shotId) {
    const shot = await this.getShot(shotId);
    const ms = shot?.measurements;
    if (!ms || ms.length < 2) return 0;
    // Use real timestamps, not count×interval
    var first = ms[0].machine?.timestamp;
    var last = ms[ms.length - 1].machine?.timestamp;
    if (first && last) {
      return Math.round((new Date(last).getTime() - new Date(first).getTime()) / 1000);
    }
    return Math.round(ms.length * 0.24); // fallback ~240ms intervals
  },

  /**
   * Convert REST API shot → TCL ::shot::create format.
   * Only does what's needed: deduplicate scale readings and extract parallel arrays.
   */
  toTclFormat(shot) {
    var ms = shot.measurements || [];
    var elapsed = [], pressure = [], pressureGoal = [],
        flow = [], flowByWeight = [], flowGoal = [],
        basket = [], mix = [], tempGoal = [],
        weight = [], waterDispensed = [],
        stateChange = [];
    var prevState = "";

    // t0 = first preinfusion/pouring point (matches chart's shotStartTime)
    var t0 = null;
    for (var i = 0; i < ms.length; i++) {
      var ss0 = ms[i].machine?.state?.substate || "";
      if (ss0 !== "preinfusion" && ss0 !== "pouring") continue;
      var ts0 = ms[i].machine?.timestamp;
      if (ts0 != null) { t0 = new Date(ts0).getTime(); break; }
    }
    if (t0 == null) t0 = 0;

    // Weight smoothing state (matching chart's SMOOTHING_FACTOR = 0.1)
    var lastScaleWeight = 0, lastScaleTime = 0, smoothedWeightChange = 0;

    for (var i = 0; i < ms.length; i++) {
      var m = ms[i].machine || {};
      var ss = m.state?.substate || "";
      // Only preinfusion & pouring (chart filters out other substates)
      if (ss !== "preinfusion" && ss !== "pouring") continue;

      var s = ms[i].scale || {};

      var mts = m.timestamp;
      var et = mts != null ? ((new Date(mts).getTime() - t0) / 1000).toFixed(1) : "0.0";
      elapsed.push(et);

      // Pressure
      pressure.push(m.pressure != null ? m.pressure.toFixed(2) : "0.0");
      pressureGoal.push(m.targetPressure != null ? m.targetPressure.toFixed(2) : "0.0");

      // Flow
      flow.push(m.flow != null ? m.flow.toFixed(2) : "0.0");
      flowGoal.push(m.targetFlow != null ? m.targetFlow.toFixed(2) : "0.0");

      // Temperature: raw °C
      basket.push(m.groupTemperature != null ? m.groupTemperature.toFixed(2) : "0.0");
      mix.push(m.mixTemperature != null ? m.mixTemperature.toFixed(2) : "0.0");
      tempGoal.push(m.targetGroupTemperature != null ? m.targetGroupTemperature.toFixed(2) : "0.0");

      // Weight: smoothed derivative on scale timestamp (chart algorithm, SMOOTHING_FACTOR=0.1)
      var weightChange = 0;
      if (s.weight != null) {
        var scaleTs = s.timestamp;
        if (scaleTs != null) {
          var scaleTime = (new Date(scaleTs).getTime() - t0) / 1000;
          if (lastScaleTime > 0 && scaleTime > lastScaleTime) {
            var timeDiff = scaleTime - lastScaleTime;
            var rawChange = (s.weight - lastScaleWeight) / timeDiff;
            smoothedWeightChange = 0.1 * rawChange + 0.9 * smoothedWeightChange;
            weightChange = smoothedWeightChange;
          }
          lastScaleWeight = s.weight;
          lastScaleTime = scaleTime;
        }
      }
      flowByWeight.push(weightChange.toFixed(2));

      weight.push(s.weight != null ? s.weight.toFixed(1) : "0.0");
      waterDispensed.push(ms[i].volume != null ? ms[i].volume.toFixed(2) : "0.0");

      // State change (detect transitions)
      var currState = (m.state?.state || "") + "/" + (m.state?.substate || "");
      stateChange.push(currState !== prevState ? "10000000.0" : "0.0");
      prevState = currState;
    }

    var et0 = parseFloat(elapsed[0]);
    for (var j = 0; j < elapsed.length; j++) {
      elapsed[j] = (parseFloat(elapsed[j]) - et0).toFixed(1);
    }

    return {
      version: "2",
      clock: String(Math.floor(Date.now() / 1000)),
      date: new Date().toString(),
      timestamp: String(Math.floor(Date.now() / 1000)),
      elapsed: elapsed,
      pressure: { pressure: pressure, goal: pressureGoal },
      flow: { flow: flow, by_weight: flowByWeight, goal: flowGoal },
      temperature: { basket: basket, mix: mix, goal: tempGoal },
      totals: { weight: weight, water_dispensed: waterDispensed },
      state_change: stateChange,
      profile: {
        title: (shot.workflow?.profile?.title) || "Default",
        author: (shot.workflow?.profile?.author) || "Decent",
        notes: (shot.workflow?.profile?.notes) || "",
        beverage_type: (shot.workflow?.profile?.beverage_type) || "espresso",
        tank_temperature: "0",
        target_weight: shot.annotations?.actualYield != null ? String(Math.round(shot.annotations.actualYield)) : "0",
        target_volume: "0",
        target_volume_count_start: String(shot.workflow?.profile?.target_volume_count_start || 0),
        version: "2"
      },
      meta: {
        bean: { brand: (shot.workflow?.context?.beanBrand) || "", type: "", notes: "", roast_level: "", roast_date: "" },
        shot: { enjoyment: "0", notes: "", tds: "0", ey: "0" },
        grinder: { model: (shot.workflow?.context?.grinderModel) || "", setting: (shot.workflow?.context?.grinderSetting) || "" },
        in: shot.annotations?.actualDoseWeight != null ? String(shot.annotations.actualDoseWeight) : "0",
        out: shot.annotations?.actualYield != null ? String(shot.annotations.actualYield) : "0",
        time: elapsed.length > 0 ? elapsed[elapsed.length - 1] : "0"
      },
      app: { app_name: "Decent.app", app_version: "1.0.0", data: {} }
    };
  }
};
`;
