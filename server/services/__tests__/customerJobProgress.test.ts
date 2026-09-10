import assert from 'node:assert/strict';
import { customerJobProgress } from '../../../shared/customerJobProgress';

assert.deepEqual(customerJobProgress({status:'completed',operationalStatus:'pending'}),{index:3,serviceLabel:'Complete'});
assert.deepEqual(customerJobProgress({status:'paid'}),{index:2,serviceLabel:'Service'},'payment alone does not prove service completion');
assert.deepEqual(customerJobProgress({status:'confirmed',operationalStatus:'en_route'}),{index:3,serviceLabel:'In Progress'});
assert.deepEqual(customerJobProgress({status:'confirmed'}),{index:3,serviceLabel:'Confirmed'});
assert.deepEqual(customerJobProgress({status:'quoted'}),{index:2,serviceLabel:'Service'});
assert.deepEqual(customerJobProgress({status:'new'}),{index:0,serviceLabel:'Service'});
assert.equal(customerJobProgress({status:'cancelled',completedAt:'2026-09-09'}),null);
