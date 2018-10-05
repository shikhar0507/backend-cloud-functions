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


module.exports = {
  getYesterdaysDateString,
  getPreviousDayMonth,
};
