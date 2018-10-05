'use strict';


const getYesterDaysDateString = () => {
  const today = new Date();

  today.setDate(today.getDate() - 1);

  return today.toDateString();
};


module.exports = {
  getYesterDaysDateString,
};
