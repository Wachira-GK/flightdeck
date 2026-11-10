/**
 * MOCK DATA ONLY (G1 prototype). No Supabase, no secrets, no real personal data.
 * Replaced by the database package once the vertical slice is wired.
 */
import type { MissionStep } from "./mission";

export type TrackStatus = "available" | "locked";

export type Track = {
  id: string;
  name: string;
  subject: string;
  description: string;
  status: TrackStatus;
  missions: number;
  completedMissions: number;
  lockedReason?: string;
};

export type Mission = {
  slug: string;
  trackId: string;
  code: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  completedSteps: MissionStep[];
  currentStep: MissionStep;
};

export type Activity = { id: string; label: string; at: string };

export const learner = {
  displayName: "Amina",
  timeZone: "Africa/Nairobi",
} as const;

export const tracks: Track[] = [
  {
    id: "excel",
    name: "Excel Masterclass",
    subject: "Excel",
    description: "From SUM to dynamic arrays, built for analysts who live in spreadsheets.",
    status: "available",
    missions: 24,
    completedMissions: 3,
  },
  {
    id: "mathlab",
    name: "MathLab",
    subject: "Statistics foundations",
    description: "Averages, spread and distributions: the maths behind every business dashboard.",
    status: "available",
    missions: 18,
    completedMissions: 1,
  },
  {
    id: "codeverse-sql",
    name: "CodeVerse SQL",
    subject: "SQL",
    description: "Query real datasets with SQL.",
    status: "locked",
    missions: 0,
    completedMissions: 0,
    lockedReason: "Coming later",
  },
];

export const missions: Mission[] = [
  {
    slug: "excel-sum-101",
    trackId: "excel",
    code: "EX-101",
    title: "Totals with SUM",
    summary: "Add up a column of monthly sales and check your answer like a pro.",
    estimatedMinutes: 12,
    completedSteps: ["briefing"],
    currentStep: "training",
  },
  {
    slug: "descriptive-stats-101",
    trackId: "mathlab",
    code: "MA-101",
    title: "Mean, median and spread",
    summary: "Describe a store's weekly sales and see why one big week moves the mean but not the median.",
    estimatedMinutes: 15,
    completedSteps: [],
    currentStep: "briefing",
  },
];

export const recentActivity: Activity[] = [
  { id: "a1", label: "Completed Briefing: Totals with SUM", at: "2026-11-10T07:42:00Z" },
  { id: "a2", label: "Passed Assessment: Cell references", at: "2026-11-09T16:05:00Z" },
  { id: "a3", label: "Started MathLab: Mean, median and mode", at: "2026-11-08T12:30:00Z" },
];

export function getMission(slug: string): Mission | undefined {
  return missions.find((m) => m.slug === slug);
}

export function getTrack(id: string): Track | undefined {
  return tracks.find((t) => t.id === id);
}

/** Placeholder sheet for the Simulation step. Values are inert strings; nothing is evaluated. */
export const simulationSheet = {
  columns: ["A", "B"],
  rows: [
    ["Month", "Sales (K)"],
    ["Jan", "120"],
    ["Feb", "95"],
    ["Mar", "143"],
    ["Total", ""],
  ],
  targetCell: "B5",
} as const;
