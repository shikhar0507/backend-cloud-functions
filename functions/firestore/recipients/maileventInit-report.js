const {db} = require('../../admin/admin');
const momentTz = require('moment-timezone');
const XlsxPopulate = require('xlsx-populate');
const {dateFormats} = require('../../admin/constants');
const {alphabetsArray} = require('./report-utils');
const sgMail = require('@sendgrid/mail');
const env = require('../../admin/env');
sgMail.setApiKey(env.sgMailApiKey);

const maileventInitReport = async () => {
  const momentToday = momentTz();
  const start = momentTz()
    .subtract(1, 'days')
    .startOf('day')
    .toString();
  const end = momentTz()
    .subtract(1, 'days')
    .endOf('day')
    .toString();
  const messageObject = {
    cc: '',
    to: env.instantEmailRecipientEmails,
    replyTo: env.mailReplyTo,
    attachments: [],
    // templateId: getTemplateId(report),
    from: {
      name: 'Growthfile',
      email: env.systemEmail,
    },
    dynamic_template_data: {
      office: '',
      subject: `MaileventInit Report ${momentToday.format(dateFormats.DATE)}`,
      date: momentToday.format(dateFormats.DATE),
    },
  };

  const header = ['Report', 'Total Users', 'office', 'Timestamp', 'Rows Count'];
  const serverRef = db.collection('MailEvents');
  let querySnapshot = await serverRef
    .where('timestamp', '>=', momentTz(start).unix())
    .where('timestamp', '<=', momentTz(end).unix())
    .get();
  if (querySnapshot) {
    const mailEventsDocs = querySnapshot.docs.map(doc => doc.data());
    const fixedValueHeader = ['Email', 'Report Name', 'Office'];
    const eventHeader = mailEventsDocs.map(a => a.event);

    const topHeader = [...new Set(fixedValueHeader.concat(eventHeader))];

    const sortedQuery = mailEventsDocs.sort(
      (a, b) =>
        (a.office > b.office ? 1 : -1) ||
        (a.reportName > b.reportName
          ? 1
          : -1 || (a.timestamp > b.timestamp ? -1 : 1)),
    );

    sortedQuery.forEach(itm => {
      itm.timestamp = momentTz(itm.timestamp * 1000).format(
        dateFormats.DATE_TIME,
      );
    });

    const maileventGroupedData = sortedQuery.reduce((mainkey, a) => {
      const {email, office, reportName, event, timestamp} = a;

      mainkey[email] = [
        ...(mainkey[email] || []),
        {
          email,
          office,
          reportName,
          event,
          timestamp,
        },
      ];

      return mainkey;
    }, {});
    const getTimestamps = maileventGroupedData => {
      const timestamps = [];
      for (const key in maileventGroupedData) {
        const sortArr = maileventGroupedData[key];
        const arr = sortArr.sort((a, b) =>
          a.timestamp > b.timestamp ? 1 : -1,
        );
        timestamps.push(arr.map(a => `${a.event} ${a.timestamp}`));
      }
      return timestamps;
    };

    const timestampData = getTimestamps(maileventGroupedData);

    const getOffice = maileventGroupedData => {
      const offices = [];
      for (const key in maileventGroupedData) {
        const arr = maileventGroupedData[key];

        offices.push(arr.map(a => `${a.office} `));
      }
      return offices;
    };

    const officeData = getOffice(maileventGroupedData);

    const getReports = maileventGroupedData => {
      const reportNames = [];
      for (const key in maileventGroupedData) {
        const arr = maileventGroupedData[key];

        reportNames.push(arr.map(a => `${a.reportName} `));
      }
      return reportNames;
    };

    const reportData = getReports(maileventGroupedData);

    const reportArr = [];
    for (let i = 0; i < reportData.length; i++) {
      reportArr.push([...new Set(reportData[i].sort())]);
    }

    const temp = [];
    for (let i = 0; i < officeData.length; i++) {
      temp.push([...new Set(officeData[i].sort())]);
    }

    const maileventsOffice = temp.map(function(x) {
      return x[0];
    });
    const maileventsReport = reportArr.map(function(x) {
      return x[0];
    });

    const emails = Object.values(maileventGroupedData).flatMap(item => [
      ...new Set(item.map(({email}) => email)),
    ]);
    const fixedHeaderData = [];
    for (let i = 0; i < emails.length; i++) {
      fixedHeaderData.push([
        emails[i],
        maileventsReport[i],
        maileventsOffice[i],
      ]);
    }

    const query = db.collection('Inits');
    querySnapshot = await query
      .where('report', 'in', ['payroll', 'footprints'])
      .get();
    if (querySnapshot) {
      const docs = querySnapshot.docs.map(doc => doc.data());
      docs.forEach(itm => {
        itm.timestamp = momentTz(itm.timestamp).format(dateFormats.DATE_TIME);
      });

      //pick certain fields from array of objects

      const newArray = docs.map(
        ({report, rowsCount, totalUsers, office, timestamp}) => ({
          report,
          rowsCount,
          totalUsers,
          office,
          timestamp,
        }),
      );

      docs.forEach(objectProperty => {
        if (
          objectProperty.hasOwnProperty('totalUsers') &&
          objectProperty.hasOwnProperty('date')
        ) {
          return;
        } else {
          objectProperty.totalUsers = '';
          objectProperty.date = '';
        }
      });

      const initGroupedData = newArray.reduce((mainkeys, a) => {
        const {report, totalUsers, office, timestamp, rowsCount} = a;

        mainkeys[report] = [
          ...(mainkeys[report] || []),
          {
            report,
            totalUsers,
            office,
            timestamp,
            rowsCount,
          },
        ];
        return mainkeys;
      }, {});
      const initData = Object.entries(initGroupedData);

      const report = initData.flatMap(([k, v]) => v.map(({report}) => report));
      const rowsCount = initData.flatMap(([k, v]) =>
        v.map(({rowsCount}) => rowsCount),
      );
      const totalUsers = initData.flatMap(([k, v]) =>
        v.map(({totalUsers}) => totalUsers),
      );
      const office = initData.flatMap(([k, v]) => v.map(({office}) => office));

      const timestamp = initData.flatMap(([k, v]) =>
        v.map(({timestamp}) => timestamp),
      );
      const initRecord = [];
      for (let i = 0; i < report.length; i++) {
        initRecord.push([
          report[i],
          totalUsers[i],
          office[i],
          timestamp[i],
          rowsCount[i],
        ]);
      }

      let count = 2;
      let column = 2;

      const reports = async () => {
        const worksheet = await XlsxPopulate.fromBlankAsync();
        const initDocs = worksheet.sheet(0).name('init user log');
        const mailEvents = worksheet.addSheet('mailEvents user log');
        const initSheet = (initRecord, initDocs) => {
          header.forEach((val, index) => {
            initDocs.cell(`${alphabetsArray[index]}1`).value(val);
          });
          initDocs.cell(`A${count}`).value(initRecord);
          count++;
        };
        initSheet(initRecord, initDocs);
        const detailRow = (fixedHeaderData, timestampData, mailEvents) => {
          topHeader.forEach((val, index) => {
            mailEvents.cell(`${alphabetsArray[index]}1`).value(val);
          });
          mailEvents.cell(`A${column}`).value(fixedHeaderData);
          mailEvents.cell(`D${column}`).value(timestampData);
          column++;
        };
        detailRow(fixedHeaderData, timestampData, mailEvents);

        messageObject.attachments.push({
          fileName: `MaileventInit Report ${momentToday.format(
            dateFormats.DATE,
          )}.xlsx`,
          content: await worksheet.outputAsync('base64'),
          type: 'text/csv',
          disposition: 'attachment',
        });
      };
      reports();
    }
  }

  return sgMail.sendMultiple(messageObject);
};

module.exports = {maileventInitReport};
