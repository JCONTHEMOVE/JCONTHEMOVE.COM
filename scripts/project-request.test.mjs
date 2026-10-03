import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
const dom=new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",{url:"https://request.test/book?mode=quick&service=moving&promo=LOCAL&jc_campaign=fall",pretendToBeVisual:true});
for(const key of ["window","document","navigator","location","history","HTMLElement","HTMLInputElement","HTMLSelectElement","Element","Node","NodeFilter","DocumentFragment","MutationObserver","CustomEvent","Event","MouseEvent","KeyboardEvent","getComputedStyle","localStorage","FileReader"]) Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
for(const key of ["addEventListener","removeEventListener","dispatchEvent"]) globalThis[key]=dom.window[key].bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);
window.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=60_000)timer.unref();return timer;};
const React=await import("react");
const {createRoot}=await import("react-dom/client");
const {QueryClient,QueryClientProvider}=await import("@tanstack/react-query");
const {screen,fireEvent}=await import("@testing-library/dom");
const {default:userEvent}=await import("@testing-library/user-event");
const output=path.resolve("node_modules/.cache/project-request-ui/component.mjs");
await mkdir(path.dirname(output),{recursive:true});
await build({stdin:{contents:'export {default as Request} from "./client/src/pages/project-request"; export {ProjectIntakeSummary} from "./client/src/components/project-intake-summary";',resolveDir:process.cwd(),loader:"tsx"},outfile:output,bundle:true,platform:"node",format:"esm",packages:"external",jsx:"automatic",loader:{".css":"empty"},define:{"import.meta.env":"{}"}});
const {Request,ProjectIntakeSummary}=await import(pathToFileURL(output).href);
const {act}=React;
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
let posts=[],failPost=false,root,client,googleAvailable=false;
globalThis.fetch=async(input,options={})=>{
 const url=String(input);
 if(url==="/api/auth/user")return response(null);
 if(url.startsWith("/api/maps-config"))return response(googleAvailable ? {key:"isolated-test-key"} : {disabled:true});
 if(url==="/api/leads/quick-request"){posts.push(JSON.parse(options.body));return failPost?response({message:"Temporary failure"},500):response({success:true,lead:{id:"test",displayOrderNumber:"TEST-123",serviceLabel:"Moving"}});}
 throw Error("Unexpected request "+url);
};
async function mount(search=""){
 historyReplace(search);
 posts=[];failPost=false;
 client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false,gcTime:0}}});
 root=createRoot(document.getElementById("root"));
 await act(async()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(Request))));
}
function historyReplace(search){window.history.replaceState(null,"","/book"+search);}
async function unmount(){await act(async()=>root.unmount());client.clear();}
const click=async name=>act(async()=>userEvent.click(screen.getByRole("button",{name,exact:true})));
const fill=async(label,value)=>act(async()=>fireEvent.change(screen.getByLabelText(label),{target:{value}}));
async function location(){
 await click("Continue");
 await fill("Street address","123 Main St");
 await fill("City","Ironwood");
 await fill("State","MI");
 await fill("ZIP code","49938");
}
async function contact(){
 await fill("First name","Test");await fill("Last name","Customer");await fill("Phone number","202-555-0123");
}
await mount("?mode=quick&service=moving&promo=LOCAL&jc_campaign=fall");
await act(async()=>userEvent.click(screen.getByRole("checkbox",{name:"Painting",exact:true})));
await location();
assert.equal(screen.getByRole("checkbox",{name:/representative/}).checked,false);
await click("Continue");
assert.match(screen.getByRole("alert").textContent,/valid project date/);
await act(async()=>userEvent.click(screen.getByRole("checkbox",{name:/representative/})));
assert.equal(screen.queryByLabelText("Preferred date"),null);
await click("Continue");await contact();
await click("Edit address and time");
assert.equal(screen.getByLabelText("Street address").value,"123 Main St");
assert.equal(screen.getByRole("checkbox",{name:/representative/}).checked,true);
await click("Continue");
assert.equal(screen.getByLabelText("First name").value,"Test");
failPost=true;await click("Send my request");
assert.match(screen.getByRole("alert").textContent,/details are still here/);
assert.equal(screen.getByLabelText("Phone number").value,"202-555-0123");
failPost=false;await click("Send my request");
assert.ok(screen.getByRole("heading",{name:"You're on our list."}));
assert.equal(posts.length,2);
assert.equal(posts[1].requestType,"project");
assert.equal(posts[1].schedulingPreference,"callback");
assert.equal(posts[1].preferredDate,undefined);
assert.equal(posts[1].destinationAddress,"");
assert.equal(posts[1].email,undefined);
assert.deepEqual(posts[1].additionalServices,["painting"]);
assert.equal(posts[1].promoCode,"LOCAL");
assert.equal(posts[1].marketingCampaignId,"fall");
await unmount();
await mount("?service=delivery");
await location();
await fill("Destination address (optional)","456 Second Street, Ironwood, MI");
await fill("Preferred date","2099-04-05");
await fill("Arrival window · Central","10:00");
await click("Continue");await contact();await fill("Email (optional)","test@example.test");
await click("Send my request");
assert.equal(posts[0].preferredDate,"2099-04-05");
assert.equal(posts[0].preferredStartTime,"10:00");
assert.equal(posts[0].email,"test@example.test");
assert.match(posts[0].destinationAddress,/456 Second/);
await unmount();
// The shared Places data API fills the structured address without changing the form flow.
const predictionRequests=[];
const selectedPlace={formattedAddress:"213 South Marquette Street, Ironwood, MI 49938, USA",fetchFields:async()=>{},addressComponents:[
 {types:["street_number"],longText:"213",shortText:"213"},
 {types:["route"],longText:"South Marquette Street",shortText:"S Marquette St"},
 {types:["locality"],longText:"Ironwood",shortText:"Ironwood"},
 {types:["administrative_area_level_1"],longText:"Michigan",shortText:"MI"},
 {types:["postal_code"],longText:"49938",shortText:"49938"},
 {types:["country"],longText:"United States",shortText:"US"},
]};
window.google={maps:{importLibrary:async(name)=>{
 assert.equal(name,"places");
 return {AutocompleteSessionToken:class {},AutocompleteSuggestion:{fetchAutocompleteSuggestions:async(request)=>{
  predictionRequests.push(request);
  return {suggestions:[{placePrediction:{placeId:"fixture-marquette",text:{toString:()=>selectedPlace.formattedAddress},toPlace:()=>selectedPlace}}]};
 }}};
}}};
googleAvailable=true;
await mount();
await click("Continue");
await act(async()=>userEvent.click(screen.getByRole("combobox",{name:"Street address"})));
await fill("Street address","213 South Mar");
await act(async()=>new Promise(resolve=>nativeTimeout(resolve,400)));
assert.equal(predictionRequests.length,1);
assert.equal(predictionRequests[0].input,"213 South Mar");
assert.ok(predictionRequests[0].sessionToken);
await act(async()=>userEvent.click(screen.getByRole("option",{name:selectedPlace.formattedAddress})));
assert.equal(screen.getByLabelText("Street address").value,"213 South Marquette Street");
assert.equal(screen.getByLabelText("City").value,"Ironwood");
assert.equal(screen.getByLabelText("State").value,"MI");
assert.equal(screen.getByLabelText("ZIP code").value,"49938");
await fill("Street address","213 South Marquette Street, Unit 2");
assert.match(screen.getByLabelText("Street address").value,/Unit 2/);
await act(async()=>userEvent.click(screen.getByRole("checkbox",{name:/representative/})));
await click("Continue");await contact();await click("Send my request");
assert.equal(posts.length,1);
assert.equal(posts[0].serviceAddress,"213 South Marquette Street, Unit 2, Ironwood, MI, 49938");
assert.equal(posts[0].city,"Ironwood");assert.equal(posts[0].state,"MI");assert.equal(posts[0].zip,"49938");
assert.equal(posts[0].schedulingPreference,"callback");
await unmount();
// Staff see normalized intent, including callback requests, after details edits.
root=createRoot(document.getElementById("root"));
const staffDetails=JSON.stringify({projectIntake:{version:1,serviceCode:"moving",additionalServices:["painting"],serviceAddress:"123 Main St, Ironwood, MI, 49938",city:"Ironwood",state:"MI",zip:"49938",destinationAddress:"",schedulingPreference:"callback",timeZone:"America/Chicago"}});
await act(async()=>root.render(React.createElement(ProjectIntakeSummary,{details:staffDetails,status:"quote_requested"})));
assert.match(document.body.textContent,/confirmation pending/);
assert.match(document.body.textContent,/Call to schedule/);
assert.match(document.body.textContent,/Also interested in: Painting/);
await act(async()=>root.render(React.createElement(ProjectIntakeSummary,{details:staffDetails,status:"available",confirmedDate:"2099-04-05"})));
assert.doesNotMatch(document.body.textContent,/confirmation pending/);
assert.match(document.body.textContent,/Original customer request/);
await act(async()=>root.unmount());
dom.window.close();
console.log("Project request UI: both scheduling paths, manual fallback, optional destination/email, retained edits, retry, attribution and staff summary passed.");
