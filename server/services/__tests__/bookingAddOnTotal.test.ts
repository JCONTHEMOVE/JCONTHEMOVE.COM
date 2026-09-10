import assert from 'node:assert/strict';
import { bookingAddOnTotal } from '../bookingPricing';
import { calculateJcTruckRentalFee } from '../../../shared/movingPricing';

const truck=calculateJcTruckRentalFee(55,true,'15 ft');
assert.equal(truck.mileageFee,25);
assert.equal(bookingAddOnTotal({truckFee:truck.totalFee,truckMileageFee:truck.mileageFee}),truck.totalFee,
  'truckFee already includes the mileage breakdown');
assert.equal(bookingAddOnTotal({truckFee:truck.totalFee,truckMileageFee:25,oversizedItemFee:100,disposalFee:20,materialsFee:10}),truck.totalFee+130);
assert.equal(bookingAddOnTotal({truckMileageFee:25}),25,'legacy mileage-only charge remains supported');
assert.equal(bookingAddOnTotal({truckFee:'525',truckMileageFee:'25'}),525);
assert.equal(bookingAddOnTotal({truckFee:-1,truckMileageFee:25,oversizedItemFee:Infinity,disposalFee:'invalid'}),25);
