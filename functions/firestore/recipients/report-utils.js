'use strict';


const getYesterdaysDateString = () => {
  const today = new Date();

  today.setDate(today.getDate() - 1);

  return today.toDateString();
};


const getPreviousDayMonth = () => {
  const today = new Date();
  const yesterday = new Date(today.setDate(today.getDate() - 1));

  return yesterday.getMonth();
};


const getNumberOfDaysInMonth = (options) => {
  const {
    month,
    year,
  } = options;

  /** Month starts with 0 */
  return new Date(year, month, 0).getDate();
};


module.exports = {
  getNumberOfDaysInMonth,
  getYesterdaysDateString,
  getPreviousDayMonth,
};
