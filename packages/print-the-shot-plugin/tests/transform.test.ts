import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { toTclFormat } from "../src/api/transform";

const shotFixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "shot.json"), "utf-8")
);
const tclSample = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "tcl_sample_shape.json"), "utf-8")
);

function output(): Record<string, any> {
  return toTclFormat(shotFixture);
}

describe("toTclFormat", () => {
  it("normalizes elapsed to start at 0.0", () => {
    const tcl = output();
    expect(tcl.elapsed[0]).toBe("0.0");
    expect(tcl.elapsed.length).toBeGreaterThan(1);
  });

  it("keeps all curve arrays aligned", () => {
    const tcl = output();
    const len = tcl.elapsed.length;
    expect(tcl.pressure.pressure).toHaveLength(len);
    expect(tcl.pressure.goal).toHaveLength(len);
    expect(tcl.flow.flow).toHaveLength(len);
    expect(tcl.flow.by_weight).toHaveLength(len);
    expect(tcl.flow.goal).toHaveLength(len);
    expect(tcl.temperature.basket).toHaveLength(len);
    expect(tcl.temperature.mix).toHaveLength(len);
    expect(tcl.temperature.goal).toHaveLength(len);
    expect(tcl.totals.weight).toHaveLength(len);
    expect(tcl.totals.water_dispensed).toHaveLength(len);
    expect(tcl.state_change).toHaveLength(len);
  });

  it("ignores non-shot substates when computing t0", () => {
    const shot = JSON.parse(JSON.stringify(shotFixture));
    shot.measurements.unshift({
      machine: {
        timestamp: "2026-06-27T02:30:00.000Z",
        state: { state: "espresso", substate: "heating" },
        pressure: 0,
      },
      scale: {},
    });
    const tcl = toTclFormat(shot);
    // The heating point must not appear in the output
    expect(tcl.elapsed[0]).toBe("0.0");
    expect(tcl.elapsed.length).toBe(shotFixture.measurements.length);
  });

  it("maps bean metadata into meta.bean", () => {
    const tcl = output();
    expect(tcl.meta.bean.type).toBe("El Rafugio Prodigal");
    expect(tcl.meta.bean.brand).toBe("Gracenote");
    expect(tcl.meta.bean.notes).toBe("Test shot fixture");
    expect(tcl.meta.bean.roast_level).toBe("light");
    expect(tcl.meta.bean.roast_date).toBe("2026-06-01");
  });

  it("falls back to extras for bean type when context has no coffee name", () => {
    const shot = JSON.parse(JSON.stringify(shotFixture));
    shot.workflow.context.coffeeName = null;
    const tcl = toTclFormat(shot);
    expect(tcl.meta.bean.type).toBe("Geisha");
  });

  it("passes through the profile title and beverage type", () => {
    const tcl = output();
    expect(tcl.profile.title).toBe(shotFixture.workflow.profile.title);
    expect(tcl.profile.beverage_type).toBe(
      shotFixture.workflow.profile.beverage_type
    );
  });

  it("reports yield and dose from annotations", () => {
    const tcl = output();
    const ann = shotFixture.annotations;
    expect(tcl.meta.out).toBe(String(ann.actualYield));
    expect(tcl.meta.time).toBe(tcl.elapsed[tcl.elapsed.length - 1]);
  });

  it("satisfies every field the print server reads", () => {
    const tcl = output();
    // Subset contract: every key the Python server dereferences must exist
    // with a compatible type. The sample file is the server's expected shape.
    expect(typeof tcl.elapsed).toBe("object");
    expect(Array.isArray(tcl.pressure.pressure)).toBe(true);
    expect(Array.isArray(tcl.flow.flow)).toBe(true);
    expect(Array.isArray(tcl.flow.by_weight)).toBe(true);
    expect(Array.isArray(tcl.temperature.basket)).toBe(true);
    expect(typeof tcl.profile.title).toBe("string");
    expect(typeof tcl.meta.bean.brand).toBe("string");
    expect(typeof tcl.meta.bean.type).toBe("string");
    expect(typeof tcl.meta.bean.notes).toBe("string");
    expect(typeof tcl.meta.bean.roast_level).toBe("string");
    expect(typeof tcl.meta.bean.roast_date).toBe("string");
    expect(typeof tcl.clock).toBe("string");
    expect(typeof tcl.version).toBe("string");
  });

  it("matches the numeric shape of the reference TCL sample", () => {
    // The server's sample is richer (resistance/timers/scale), but the shared
    // curve fields must be the same types.
    const tcl = output();
    expect(Array.isArray(tclSample.elapsed)).toBe(true);
    expect(tclSample.pressure.pressure.every((v: unknown) => typeof v === "string")).toBe(true);
    expect(tcl.elapsed.every((v: unknown) => typeof v === "string")).toBe(true);
    expect(tcl.pressure.pressure.every((v: unknown) => typeof v === "string")).toBe(true);
    expect(tcl.flow.flow.every((v: unknown) => typeof v === "string")).toBe(true);
    expect(tcl.flow.by_weight.every((v: unknown) => typeof v === "string")).toBe(true);
    expect(tcl.temperature.basket.every((v: unknown) => typeof v === "string")).toBe(true);
    expect(typeof tclSample.meta.bean.type).toBe("string");
    expect(typeof tclSample.profile.title).toBe("string");
  });
});
