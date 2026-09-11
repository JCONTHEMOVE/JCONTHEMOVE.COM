import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Synthetic customer-reported inventories, not approved lifting or staffing guidance.
// Each archetype appears under ten materially different access/scheduling conditions.
const jobs = [
  ['moving','Studio apartment','12 boxes, twin bed, loveseat, desk, two chairs',110],
  ['moving','One-bedroom apartment','25 boxes, queen bed, sofa, dresser, dining table and four chairs',180],
  ['moving','Two-bedroom apartment','45 boxes, two beds, two dressers, sofa, recliner, dining set',220],
  ['moving','Three-bedroom home','70 boxes, three beds, sectional, dining set, three dressers',250],
  ['moving','Four-bedroom family home','110 boxes, four beds, sectional, office furniture, two dining sets',280],
  ['moving','Senior downsizing','30 boxes, adjustable bed, recliner, china cabinet with glass shelves',260],
  ['moving','Student room','8 boxes, futon, desk, bookcase, bicycle',85],
  ['moving','Two-room office','20 file boxes, four desks, four chairs, two filing cabinets',200],
  ['moving','Small retail relocation','35 stock boxes, six shelving units, counter, two display cases',240],
  ['moving','Cabin relocation','22 totes, bunk bed, sleeper sofa, patio table, freezer',300],
  ['moving','Storage unit to apartment','40 boxes, queen bed, sofa, dresser and dining set from a 10x15 unit',200],
  ['moving','House to storage','60 boxes, three beds, sectional, two dressers into a 10x20 unit',260],
  ['moving','Apartment with upright piano','28 boxes, queen bed, sofa and upright piano estimated at 500 lb',500],
  ['moving','Home with gun safe','50 boxes, two beds, sofa and an empty safe estimated at 650 lb',650],
  ['moving','Workshop relocation','15 toolboxes, workbench, drill press, table saw and compressor',420],
  ['moving','Home gym relocation','Treadmill, elliptical, weight rack, 400 lb of loose plates and 12 boxes',350],
  ['moving','Restaurant equipment move','Three stainless tables, shelving, disconnected commercial refrigerator',700],
  ['moving','Fragile household move','36 boxes, glass dining table, two mirrors, artwork and antique cabinet',210],
  ['moving','Large book collection','90 book boxes, six bookcases, desk, bed and sofa',160],
  ['moving','Partially furnished house','15 boxes, king bed, sectional, dresser, washer and dryer',320],
  ['load_only','Cargo van loading','8 boxes, desk, office chair, twin mattress into a customer cargo van',70],
  ['load_only','15-foot truck loading','25 boxes, queen bed, sofa, dresser into a customer 15-foot truck',180],
  ['load_only','20-foot truck loading','50 boxes, two beds, sectional, dining set into a customer 20-foot truck',230],
  ['load_only','26-foot truck loading','90 boxes, three beds, cabinets and full living room into a customer 26-foot truck',280],
  ['load_only','Two U-Box containers','40 boxes, two beds, sofa, two dressers into two customer U-Box containers',200],
  ['unload_only','Cargo van unloading','10 totes, futon, desk and bicycle from a customer cargo van',90],
  ['unload_only','15-foot truck unloading','25 boxes, sofa, queen bed and dresser from a customer 15-foot truck',180],
  ['unload_only','20-foot truck unloading','55 boxes, two beds, dining set and sectional from a customer 20-foot truck',250],
  ['unload_only','26-foot truck unloading','100 boxes, three beds, cabinets and workshop tools from a customer 26-foot truck',320],
  ['unload_only','Three U-Box containers','60 boxes, three beds, two sofas and dining furniture from three customer U-Box containers',240],
  ['delivery','Standard sofa delivery','One 84-inch sofa, customer-estimated 180 lb',180],
  ['delivery','Sleeper sofa delivery','One 90-inch sleeper sofa, customer-estimated 300 lb',300],
  ['delivery','Refrigerator delivery','One disconnected refrigerator, customer-estimated 320 lb; no plumbing work requested',320],
  ['delivery','Washer and dryer delivery','One disconnected washer at 220 lb and dryer at 140 lb; no hookups requested',220],
  ['delivery','King bedroom delivery','King mattress, bed frame and dresser, heaviest piece estimated at 230 lb',230],
  ['delivery','Safe delivery','Empty safe, model and dimensions supplied, customer-estimated 550 lb',550],
  ['delivery','Upright piano delivery','Upright piano with dimensions supplied, customer-estimated 480 lb',480],
  ['delivery','Large conference table','12-foot conference table with removable legs, customer-estimated 280 lb',280],
  ['junk_removal','Single mattress removal','One king mattress and box spring; disposal pricing not supplied',100],
  ['junk_removal','Sofa removal','One worn sleeper sofa estimated at 290 lb; disposal pricing not supplied',290],
  ['junk_removal','Small garage cleanout','Approximately 3 cubic yards of bagged clutter and broken shelving; no chemicals reported',120],
  ['junk_removal','Large garage cleanout','Approximately 8 cubic yards of furniture, boxes and two broken appliances; no chemicals reported',300],
  ['junk_removal','Basement furniture cleanout','Two sofas, freezer, shelving and 20 bags; freezer disconnected',280],
  ['junk_removal','Renovation debris pickup','Approximately 2 cubic yards of bagged tile and lumber; material weights unconfirmed',null],
  ['junk_removal','Estate cleanout','Approximately 12 cubic yards of mixed household contents; item list incomplete',null],
  ['packing','Kitchen packing','Contents of 20 kitchen cabinets, dishes, glassware, cookware; supplies needed',40],
  ['packing','Two-bedroom packing','Two-bedroom home contents, estimated 60 finished boxes; supplies needed',45],
  ['packing','Fragile collection packing','40 framed artworks and 12 glass collectibles; dimensions supplied, supplies needed',50],
  ['assembly','Bedroom assembly','Two flat-pack queen bed frames and two six-drawer dressers; sealed boxes, instructions present',130],
  ['assembly','Office assembly','Six flat-pack desks and six office chairs; sealed boxes, instructions present',90],
];
const variants = [
  { label:'Clear local weekday', flights:0, destination:0, carry:25, distance:5, timing:'Weekday morning', condition:'Dry, level, clear access', ready:'Everything packed or staged; listed quantities confirmed; ask for dimensions not stated', request:[2,2], uncertainty:null },
  { label:'One flight and tight landing', flights:1, destination:0, carry:40, distance:10, timing:'Weekday afternoon', condition:'Dry stairs with one 90-degree turn; clear handrail', ready:'Packed or staged; measure the tight landing before promising fit', request:[1,1], uncertainty:'Landing clearance for the largest item is not measured' },
  { label:'Third-floor stairs', flights:2, destination:1, carry:60, distance:15, timing:'Saturday morning', condition:'No elevator; dry stairs wherever flights are listed', ready:'Packed or staged; customer wants the lowest price', request:[2,2], uncertainty:null },
  { label:'Elevator reservation', flights:0, destination:0, carry:180, distance:8, timing:'Weekday 10 AM; two-hour elevator reservation', condition:'Service elevator: 48 by 72 inch cab, 42 inch door, posted 1500 lb limit; 180-foot hallway', ready:'Packed or staged; elevator shared with other tenants', request:[2,2], uncertainty:'Waiting time and item fit in shared elevator need confirmation' },
  { label:'Long carry and gravel', flights:0, destination:0, carry:250, distance:25, timing:'Sunday afternoon', condition:'250-foot gravel carry; truck cannot approach entrance', ready:'Packed or staged; customer can direct placement but will not lift', request:[2,1], uncertainty:null },
  { label:'Regional travel', flights:1, destination:1, carry:75, distance:60, timing:'Weekday morning', condition:'Dry stairs wherever flights are listed; clear parking', ready:'Packed or staged; listed quantities confirmed; ask for dimensions not stated', request:[3,3], uncertainty:null },
  { label:'Winter access problem', flights:2, destination:0, carry:100, distance:20, timing:'Saturday 7 AM in winter', condition:'Snow and ice reported on steps and carry path; clearing not confirmed', ready:'Customer asks crew to start before the path is cleared', request:[2,2], uncertainty:'Safe cleared access has not been confirmed' },
  { label:'Customer help and short booking', flights:1, destination:1, carry:50, distance:12, timing:'Weekday evening', condition:'Dry stairs, clear parking', ready:'Customer offers two friends as lifting help; experience and availability unconfirmed', request:[1,1], uncertainty:'Do not assume customer friends replace trained crew' },
  { label:'Unready and last minute', flights:1, destination:0, carry:90, distance:35, timing:'Same-day afternoon; must finish before 5 PM', condition:'Narrow hall; actual door width not supplied', ready:'Some contents still loose; disassembly or unpacking of components may be needed', request:[2,2], uncertainty:'Readiness, access dimensions and deadline feasibility need confirmation' },
  { label:'Incomplete request', flights:null, destination:null, carry:null, distance:null, timing:'Date and arrival window not provided', condition:'Customer says access is easy but provides no photos or measurements', ready:'Inventory above is approximate; customer says there may be additional items', request:[1,1], uncertainty:'Confirm stairs, carry distance, travel, inventory, dimensions and scheduling' },
];
const scenarios = [];
for (let j=0;j<jobs.length;j++) for (let v=0;v<variants.length;v++) {
  const [service,title,inventory,weight] = jobs[j];
  const c=variants[v];
  const hasTransport=['moving','delivery'].includes(service);
  const scope=service==='moving'?'Load, transport and unload':service==='load_only'?'Load only; no transport or unload':service==='unload_only'?'Unload only; no loading or transport':service==='delivery'?'Pickup, transport and placement':service==='junk_removal'?'Remove, haul and dispose':service==='packing'?'Pack only; no loading or transport':'Assemble only; no moving between addresses';
  const origin=service==='unload_only'?0:c.flights;
  const destination=service==='unload_only'?c.flights:hasTransport?c.destination:0;
  const features={service,archetype:j+1,scope,inventory,heaviestItemLb:weight,originStairFlights:origin,destinationStairFlights:destination,carryFeet:c.carry,
    depotToJobRoadMiles:c.distance,loadedRoadMiles:hasTransport?(c.distance==null?null:Math.round(c.distance*0.8)+2):null,
    truck:hasTransport?'Company transport requested; choose suitable truck and equipment':service==='junk_removal'?'Company haul vehicle requested; disposal costs unknown':service.includes('only')?'Customer truck or containers; no company transport':'No transport requested',
    timing:c.timing,access:c.condition,readiness:c.ready,requestedCrew:c.request[0],requestedHours:c.request[1],uncertainty:c.uncertainty};
  const access=`${origin??'Unknown'} pickup/service stair flights; ${destination??'unknown'} destination stair flights; ${c.carry??'unknown'} ft carry. ${c.condition}.`;
  const trip=`Depot to first service address: ${c.distance??'unknown'} one-way road miles.${hasTransport?` Loaded trip: ${features.loadedRoadMiles??'unknown'} road miles.`:' No customer transport between addresses is requested.'}`;
  const request=`I need help with ${title.toLowerCase()}: ${inventory}. Heaviest individual item: ${weight==null?'weight unknown':`customer-estimated ${weight} lb`}. ${scope}. ${access} ${trip} ${c.timing}. ${c.ready}. Could I book ${c.request[0]} ${c.request[0]===1?'worker':'workers'} for ${c.request[1]} ${c.request[1]===1?'hour':'hours'}? Please explain the quote and anything you need me to confirm.`;
  scenarios.push({id:`JC-TRAIN-${String(j*10+v+1).padStart(3,'0')}`,service,title:`${title} — ${c.label}`,request,features,
    fingerprint:createHash('sha256').update(JSON.stringify(features)).digest('hex'),
    teachingPrompts:'What changes crew and time? What is the minimum you will sell? What costs are included or separate? What must be confirmed before acceptance?',
    review:{status:'Not started',decision:null,difficulty:null,minimumCrew:null,recommendedCrew:null,minimumBillableHours:null,expectedElapsedHours:null,preTaxTotal:null,laborPrice:null,travelPrice:null,equipmentPrice:null,disposalMaterialsPrice:null,otherFees:null,discount:null,reasoning:null,requiredEquipment:null,followUpQuestions:null,ruleConditions:null,reviewer:null}});
}
// Reproducibly mix the requests into 25 manageable batches of 20.
let seed=20260910;
for(let i=scenarios.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[scenarios[i],scenarios[j]]=[scenarios[j],scenarios[i]];}
scenarios.forEach((s,i)=>{s.batch=Math.floor(i/20)+1;s.order=i+1;});
const output=path.join(root,'training/pricing');
await fs.mkdir(output,{recursive:true});
await fs.writeFile(path.join(output,'scenarios.json'),JSON.stringify({version:1,seed:20260910,synthetic:true,scenarioCount:scenarios.length,scenarios},null,2)+'\n');
console.log(`Generated ${scenarios.length} synthetic pricing requests in 25 batches`);

await fs.writeFile(path.join(root,"shared/pricingTrainingScenarios.ts"),'// Generated by scripts/generate-pricing-training.mjs. Synthetic, unreviewed requests.\nimport type { PricingTrainingScenario } from "./pricingTraining";\nexport const pricingTrainingScenarios: PricingTrainingScenario[] = '+JSON.stringify(scenarios.map(({review,teachingPrompts,...scenario})=>scenario),null,0)+';\n');
