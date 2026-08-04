// Map registry. Each entry exposes an INFO block (bounds, spawns, hotspots) and
// a build(scene, physics) that returns the lights, sky and stair runs.
import * as district7 from './district7.js';
import * as foundry from './foundry.js';
import * as coldharbor from './coldharbor.js';
import * as mesa from './mesa.js';
import * as greenfall from './greenfall.js';
import * as caldera from './caldera.js';

export const MAPS = {
  district7: {
    id: 'district7',
    name: 'DISTRICT 7',
    tagline: 'OPEN URBAN BLOCK · LONG SIGHTLINES',
    info: district7.INFO,
    build: district7.build,
  },
  foundry: {
    id: 'foundry',
    name: 'THE FOUNDRY',
    tagline: 'DENSE INDUSTRIAL WARREN · CLOSE QUARTERS',
    info: foundry.INFO,
    build: foundry.build,
  },
  coldharbor: {
    id: 'coldharbor',
    name: 'COLD HARBOR',
    tagline: 'SNOWBOUND STATION · ROLLING TERRAIN',
    info: coldharbor.INFO,
    build: coldharbor.build,
  },
  mesa: {
    id: 'mesa',
    name: 'RED MESA',
    tagline: 'DESERT CANYON · SUNKEN RIVERBED',
    info: mesa.INFO,
    build: mesa.build,
  },
  greenfall: {
    id: 'greenfall',
    name: 'GREENFALL',
    tagline: 'HIGHLAND VALLEY · RIVER CROSSING',
    info: greenfall.INFO,
    build: greenfall.build,
  },
  caldera: {
    id: 'caldera',
    name: 'CALDERA',
    tagline: 'VOLCANIC CRATER · FIGHT FOR THE RIM',
    info: caldera.INFO,
    build: caldera.build,
  },
};

export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'district7';
