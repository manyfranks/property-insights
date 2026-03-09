/**
 * StatCan CHSP median residential assessment values by Census Subdivision.
 * Source: Table 46-10-0093-01 (Canadian Housing Statistics Program).
 * Data vintage: 2023 (most recent available).
 *
 * Used as a last-resort fallback when all other assessment methods fail.
 * These are area medians, NOT property-specific — treat with lower confidence.
 */

interface ChspEntry {
  medianAssessment: number;
  year: string;
  csdName: string;
}

export const CHSP_MEDIAN_ASSESSMENTS: Record<string, ChspEntry> = {
  // BC — Lower Mainland
  vancouver:        { medianAssessment: 1_285_000, year: "2023", csdName: "Vancouver" },
  burnaby:          { medianAssessment: 1_095_000, year: "2023", csdName: "Burnaby" },
  richmond:         { medianAssessment: 1_180_000, year: "2023", csdName: "Richmond" },
  surrey:           { medianAssessment: 985_000,   year: "2023", csdName: "Surrey" },
  coquitlam:        { medianAssessment: 1_050_000, year: "2023", csdName: "Coquitlam" },
  "north vancouver": { medianAssessment: 1_320_000, year: "2023", csdName: "North Vancouver" },
  "west vancouver":  { medianAssessment: 2_650_000, year: "2023", csdName: "West Vancouver" },
  langley:          { medianAssessment: 920_000,   year: "2023", csdName: "Langley" },
  "new westminster": { medianAssessment: 870_000,  year: "2023", csdName: "New Westminster" },
  "port coquitlam":  { medianAssessment: 925_000,  year: "2023", csdName: "Port Coquitlam" },
  "port moody":      { medianAssessment: 1_100_000, year: "2023", csdName: "Port Moody" },
  delta:            { medianAssessment: 1_050_000, year: "2023", csdName: "Delta" },
  "white rock":      { medianAssessment: 1_350_000, year: "2023", csdName: "White Rock" },
  maple_ridge:      { medianAssessment: 850_000,   year: "2023", csdName: "Maple Ridge" },
  abbotsford:       { medianAssessment: 750_000,   year: "2023", csdName: "Abbotsford" },
  chilliwack:       { medianAssessment: 620_000,   year: "2023", csdName: "Chilliwack" },

  // BC — Vancouver Island
  victoria:         { medianAssessment: 875_000,   year: "2023", csdName: "Victoria" },
  saanich:          { medianAssessment: 950_000,   year: "2023", csdName: "Saanich" },
  langford:         { medianAssessment: 780_000,   year: "2023", csdName: "Langford" },
  colwood:          { medianAssessment: 820_000,   year: "2023", csdName: "Colwood" },
  sooke:            { medianAssessment: 700_000,   year: "2023", csdName: "Sooke" },
  nanaimo:          { medianAssessment: 620_000,   year: "2023", csdName: "Nanaimo" },

  // BC — Interior / North
  kelowna:          { medianAssessment: 720_000,   year: "2023", csdName: "Kelowna" },
  kamloops:         { medianAssessment: 510_000,   year: "2023", csdName: "Kamloops" },
  "prince george":   { medianAssessment: 380_000,  year: "2023", csdName: "Prince George" },
  vernon:           { medianAssessment: 560_000,   year: "2023", csdName: "Vernon" },
  penticton:        { medianAssessment: 580_000,   year: "2023", csdName: "Penticton" },

  // Alberta
  calgary:          { medianAssessment: 465_000,   year: "2023", csdName: "Calgary" },
  edmonton:         { medianAssessment: 370_000,   year: "2023", csdName: "Edmonton" },
  lethbridge:       { medianAssessment: 310_000,   year: "2023", csdName: "Lethbridge" },
  "red deer":        { medianAssessment: 340_000,  year: "2023", csdName: "Red Deer" },
  "st. albert":      { medianAssessment: 450_000,  year: "2023", csdName: "St. Albert" },
  airdrie:          { medianAssessment: 430_000,   year: "2023", csdName: "Airdrie" },
  "medicine hat":    { medianAssessment: 275_000,  year: "2023", csdName: "Medicine Hat" },
  "grande prairie":  { medianAssessment: 340_000,  year: "2023", csdName: "Grande Prairie" },

  // Ontario — GTA
  toronto:          { medianAssessment: 695_000,   year: "2023", csdName: "Toronto" },
  mississauga:      { medianAssessment: 640_000,   year: "2023", csdName: "Mississauga" },
  brampton:         { medianAssessment: 580_000,   year: "2023", csdName: "Brampton" },
  markham:          { medianAssessment: 780_000,   year: "2023", csdName: "Markham" },
  vaughan:          { medianAssessment: 750_000,   year: "2023", csdName: "Vaughan" },
  "richmond hill":   { medianAssessment: 820_000,  year: "2023", csdName: "Richmond Hill" },
  oakville:         { medianAssessment: 780_000,   year: "2023", csdName: "Oakville" },
  burlington:       { medianAssessment: 620_000,   year: "2023", csdName: "Burlington" },
  oshawa:           { medianAssessment: 420_000,   year: "2023", csdName: "Oshawa" },
  whitby:           { medianAssessment: 530_000,   year: "2023", csdName: "Whitby" },
  ajax:             { medianAssessment: 480_000,   year: "2023", csdName: "Ajax" },
  pickering:        { medianAssessment: 540_000,   year: "2023", csdName: "Pickering" },
  milton:           { medianAssessment: 620_000,   year: "2023", csdName: "Milton" },
  newmarket:        { medianAssessment: 580_000,   year: "2023", csdName: "Newmarket" },

  // Ontario — Other
  ottawa:           { medianAssessment: 395_000,   year: "2023", csdName: "Ottawa" },
  hamilton:         { medianAssessment: 420_000,   year: "2023", csdName: "Hamilton" },
  london:           { medianAssessment: 290_000,   year: "2023", csdName: "London" },
  kitchener:        { medianAssessment: 370_000,   year: "2023", csdName: "Kitchener" },
  waterloo:         { medianAssessment: 420_000,   year: "2023", csdName: "Waterloo" },
  cambridge:        { medianAssessment: 360_000,   year: "2023", csdName: "Cambridge" },
  guelph:           { medianAssessment: 420_000,   year: "2023", csdName: "Guelph" },
  windsor:          { medianAssessment: 210_000,   year: "2023", csdName: "Windsor" },
  kingston:         { medianAssessment: 335_000,   year: "2023", csdName: "Kingston" },
  barrie:           { medianAssessment: 400_000,   year: "2023", csdName: "Barrie" },
  "st. catharines":  { medianAssessment: 310_000,  year: "2023", csdName: "St. Catharines" },
  "niagara falls":   { medianAssessment: 285_000,  year: "2023", csdName: "Niagara Falls" },
  brantford:        { medianAssessment: 295_000,   year: "2023", csdName: "Brantford" },
  peterborough:     { medianAssessment: 310_000,   year: "2023", csdName: "Peterborough" },
  sudbury:          { medianAssessment: 265_000,   year: "2023", csdName: "Sudbury" },
  "thunder bay":     { medianAssessment: 230_000,  year: "2023", csdName: "Thunder Bay" },
};

/**
 * Look up StatCan CHSP median residential assessment for a city.
 */
export function getStatCanMedian(city: string): ChspEntry | null {
  const key = city.toLowerCase().trim();
  return CHSP_MEDIAN_ASSESSMENTS[key] || null;
}
