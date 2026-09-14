import assert from "node:assert/strict";
import { customerNotesFromDetails, updateCustomerNotes } from "../../../shared/leadDetails";

const original = JSON.stringify({ selectedPackage: { label: "Jump Start", maxPrice: 450, depositRequired: true }, notes: "Use the side door", tag: "legacy" });
assert.equal(customerNotesFromDetails(original), "Use the side door");
assert.equal(customerNotesFromDetails('{"selectedPackage":{"maxPrice":450}}'), "");
assert.equal(customerNotesFromDetails("Call before arrival"), "Call before arrival");
assert.equal(updateCustomerNotes(original, "Use the side door"), original);
const changed = updateCustomerNotes(original, "Use the back door");
assert.deepEqual(JSON.parse(changed).selectedPackage, JSON.parse(original).selectedPackage);
assert.equal(JSON.parse(changed).tag, "legacy");
assert.equal(customerNotesFromDetails(changed), "Use the back door");
assert.equal(customerNotesFromDetails(updateCustomerNotes(changed, "")), "");
assert.equal(updateCustomerNotes("old note", " new note "), "new note");
assert.equal(customerNotesFromDetails(null), "");
const chatbot = JSON.stringify({
  _source: "chatbot", answers: { notes: "Use the ramp", moveDate: "Next week" },
  bookingIntake: { notes: "Use the ramp" }, selectedPackage: { label: "Jump Start", maxPrice: 450 },
});
assert.equal(customerNotesFromDetails(chatbot), "Use the ramp");
assert.equal(updateCustomerNotes(chatbot, "Use the ramp"), chatbot);
const editedChatbot = updateCustomerNotes(chatbot, "Call at the gate");
assert.equal(customerNotesFromDetails(editedChatbot), "Call at the gate");
assert.deepEqual(JSON.parse(editedChatbot).answers, JSON.parse(chatbot).answers);
assert.deepEqual(JSON.parse(editedChatbot).selectedPackage, JSON.parse(chatbot).selectedPackage);
assert.equal(customerNotesFromDetails(updateCustomerNotes(editedChatbot, "")), "");
assert.equal(customerNotesFromDetails(JSON.stringify({ answers: { notes: "" }, bookingIntake: { notes: "Use side door" } })), "Use side door");
assert.equal(customerNotesFromDetails(JSON.stringify({ answers: [], bookingIntake: null, selectedPackage: { notes: "Not customer instructions" } })), "");
console.log("Customer notes remain readable; editing and clearing preserve package metadata.");
