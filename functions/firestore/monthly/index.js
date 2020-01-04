/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

'use strict';

const {rootCollections} = require('../../admin/admin');
const {findKeyByValue} = require('../../admin/utils');
const {allMonths} = require('../../admin/constants');

module.exports = async (change, context) => {
  const statusObject = change.after.get('statusObject') || {};
  const {phoneNumber, officeId} = context.params;

  try {
    const profileDoc = await rootCollections.profiles.doc(phoneNumber).get();
    const employeeOf = profileDoc.get('employeeOf') || {};
    const office = findKeyByValue(employeeOf, officeId);

    if (!office) {
      return Promise.resolve();
    }

    const {path} = change.after.ref;
    const parts = path.split('/');
    const monthYearString = parts[3];
    const [month, year] = monthYearString.split(' ');

    const result = [];

    Object.keys(statusObject).forEach(date => {
      const o = Object.assign(
        {},
        {
          office,
          date: Number(date),
          year: Number(year),
          month: allMonths[month],
        },
        statusObject[date],
      );

      result.push(o);
    });

    return rootCollections.profiles.doc(phoneNumber).set(
      {
        statusObject: result,
      },
      {
        merge: true,
      },
    );
  } catch (error) {
    console.error(error);
  }
};
