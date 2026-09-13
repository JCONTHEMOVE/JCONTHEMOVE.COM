import { z } from 'zod';

export const GROWTH_CAMPAIGN = 'fall-2026';
export const workerAvatarSchema=z.object({
  character:z.enum(['mover','robot','explorer','spark']),
  color:z.enum(['cyan','violet','amber','emerald','rose']),
  accessory:z.enum(['none','cap','headphones','glasses']),
}).strict();
export type WorkerAvatar = z.infer<typeof workerAvatarSchema>;
export const DEFAULT_WORKER_AVATAR:WorkerAvatar={character:'mover',color:'cyan',accessory:'none'};
export const GROWTH_GOALS = [
  {key:'outreach',label:'Outreach',initial:3,max:20},
  {key:'qualifiedInquiries',label:'Qualified leads',initial:2,max:20},
  {key:'bookings',label:'Bookings',initial:1,max:10},
  {key:'scenarios',label:'Training',initial:5,max:25},
  {key:'activeDays',label:'Active days',initial:3,max:7},
] as const;
export const workerGrowthGoalsSchema=z.object({
  outreach:z.number().int().min(0).max(20),qualifiedInquiries:z.number().int().min(0).max(20),
  bookings:z.number().int().min(0).max(10),scenarios:z.number().int().min(0).max(25),activeDays:z.number().int().min(0).max(7),
}).strict();
export const DEFAULT_GROWTH_GOALS={outreach:3,qualifiedInquiries:2,bookings:1,scenarios:5,activeDays:3};
export const GROWTH_PARTNERS = [
  {slug:'matt',lane:'Moving labor',service:'moving',backup:'evan'},
  {slug:'troy',lane:'Cleanouts',service:'junk_removal',backup:'bill'},
  {slug:'bill',lane:'Cabins and seasonal properties',service:'lawn_seasonal',backup:'troy'},
  {slug:'evan',lane:'Downsizing and family transitions',service:'packing',backup:'matt'},
] as const;
export const growthProofSchema=z.object({proofUrl:z.string().url().max(2000).optional().or(z.literal('')),notes:z.string().trim().min(5).max(2000)}).strict();
export const growthPreferencesSchema=z.object({enabled:z.boolean(),morning:z.number().int().min(8).max(19),followup:z.number().int().min(8).max(19)}).strict();
export function chicagoDate(date=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function growthWeek(date:string){
  const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);
}
export function growthEligibility(input:{bookedAt:string|null;qualifiedAt:string|null;activatedAt:string|null;cancelled:boolean;selfReferral:boolean}){
  if(input.selfReferral)return 'Self-referrals do not qualify';
  if(input.cancelled)return 'Job cancelled or refunded';
  if(!input.bookedAt)return 'Booking acceptance has not been recorded';
  if(!input.activatedAt||new Date(input.bookedAt)<new Date(input.activatedAt))return 'Booked before campaign activation';
  const booked=chicagoDate(new Date(input.bookedAt));
  if(booked<'2026-09-14'||booked>'2026-10-31')return 'Outside campaign booking dates';
  if(input.qualifiedAt&&chicagoDate(new Date(input.qualifiedAt))>'2026-11-30')return 'Completion/payment deadline passed';
  return null;
}
