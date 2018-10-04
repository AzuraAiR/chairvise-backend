import Papa from 'papaparse';
import _ from 'lodash';
import util, { fillRange, sum } from './util';

const papaConfig = {
  header: true,
  dynamicTyping: true,
  trimHeaders: true,
  skipEmptyLines: true
};

const getAuthorInfo = file => {
  // author.csv: header row, author names with affiliations, countries, emails
  // data format:
  // submission ID | f name | s name | email | country | affiliation | page | person ID | corresponding?
  // replace first line with a nicer header for objects
  let content = file.buffer.toString('utf8');
  content =
    'submissionId, firstName, lastName, email, country, affiliation, page, personId, corresponding\r' +
    content.substring(content.indexOf('\r') + 1);
  const parsedContent = Papa.parse(content, papaConfig);

  if (parsedContent.errors.length !== 0) {
    // error handling
    console.error('parsing has issues:', parsedContent.errors);
    // return false;
  }

  const authorList = [];
  const authors = [];
  const countries = [];
  const affiliations = [];
  parsedContent.data.map(row => {
    const { firstName, lastName, country, affiliation } = row;
    const name = firstName + ' ' + lastName;
    authorList.push({ name, country, affiliation });
    authors.push(name);
    countries.push(country);
    affiliations.push(affiliation);
  });

  const authorCounts = _.countBy(authors);
  const countryCounts = _.countBy(countries);
  const affiliationCounts = _.countBy(affiliations);

  const authorLabels = [];
  const authorData = [];
  util.getSortedArrayFromMapUsingCount(authorCounts).map(x => {
    authorLabels.push(x[0]);
    authorData.push(x[1]);
  });

  const countryLabels = [];
  const countryData = [];
  util.getSortedArrayFromMapUsingCount(countryCounts).map(x => {
    countryLabels.push(x[0]);
    countryData.push(x[1]);
  });

  const affiliationLabels = [];
  const affiliationData = [];
  util.getSortedArrayFromMapUsingCount(affiliationCounts).map(x => {
    affiliationLabels.push(x[0]);
    affiliationData.push(x[1]);
  });

  const parsedResult = {
    topAuthors: { labels: authorLabels, data: authorData },
    topCountries: { labels: countryLabels, data: countryData },
    topAffiliations: { labels: affiliationLabels, data: affiliationData }
  };

  return { infoType: 'author', infoData: parsedResult };
};

const getReviewInfo = file => {
  // review.csv
  // data format:
  // review ID | paper ID? | reviewer ID | reviewer name | unknown | text | scores | overall score | unknown | unknown | unknown | unknown | date | time | recommend?
  // File has NO header
  // score calculation principles:
  // Weighted Average of the scores, using reviewer's confidence as the weights
  // recommended principles:
  // Yes: 1; No: 0; weighted average of the 1 and 0's, also using reviewer's confidence as the weights
  const content = 'reviewId, paperId, reviewerId, reviewerName, unknown, text, scores, overallScore, unknown, unknown, unknown, unknown, date, time, recommend\n' + (file.buffer.toString('utf8'));
  const parsedContent = Papa.parse(content, papaConfig);
  if (parsedContent.errors.length !== 0) {
    // error handling
    console.error('parsing has issues:', parsedContent.errors);
    // return false;
  }

  // Idea: from -3 to 3 (min to max scores possible), every 0.25 will be a gap
  const scoreDistributionCounts = fillRange(-3, 3, 0.25);
  const recommendDistributionCounts = fillRange(0, 1, 0.1);

  const scoreDistributionLabels = [];
  const recommendDistributionLabels = [];

  for (let i = 0; i < scoreDistributionCounts.length - 1; i++) {
    scoreDistributionLabels[i] = scoreDistributionCounts[i] + ' ~ ' + scoreDistributionCounts[i + 1];
  }
  for (let i = 0; i < recommendDistributionCounts.length - 1; i++) {
    recommendDistributionLabels[i] = recommendDistributionCounts[i] + ' ~ ' + recommendDistributionCounts[i + 1];
  }

  const confidenceList = [];
  const recommendList = [];
  const scoreList = [];
  const submissionIDReviewMap = {};
  const reviewsGroupBySubmissionId = _.mapValues(_.groupBy(parsedContent.data, 'paperId'));
  for (const submissionId in reviewsGroupBySubmissionId) {
    const scores = [];
    const confidences = [];
    const recommends = [];
    const weightedScores = [];
    const weightedRecommends = [];
    reviewsGroupBySubmissionId[submissionId].map(review => {
      // overall evaluation || reviewer's confidence || Recommend for best paper
      // Sample: Overall evaluation: -3\nReviewer's confidence: 5\nRecommend for best paper: no
      const evaluation = review.scores.split(/[\r\n]+/);
      const score = evaluation[0].split(': ')[1];
      scores.push(score);
      const confidence = evaluation[1].split(': ')[1];
      confidences.push(confidence);
      let recommend;
      if (evaluation.length > 2) {
        recommend = evaluation[2].split(': ')[1] === 'yes' ? 1 : 0;
      } else {
        recommend = 0;
      }
      recommends.push(recommend);
      weightedScores.push(score * confidence);
      weightedRecommends.push(recommend * confidence);
    });

    const confidenceSum = confidences.reduce(sum);
    confidenceList.push(confidenceSum / confidences.length);

    const totalWeightedScore = weightedScores.reduce(sum) / confidenceSum;
    const totalWeightedRecommend = weightedRecommends.reduce(sum) / confidenceSum;

    scoreList.push(totalWeightedScore);
    recommendList.push(totalWeightedRecommend);

    const scoreColumn = Math.min(((totalWeightedScore + 3) / 0.25).toFixed(1), 23);
    const recommendColumn = Math.min(((totalWeightedRecommend) / 0.1).toFixed(1), 9);
    scoreDistributionCounts[scoreColumn] += 1;
    recommendDistributionCounts[recommendColumn] += 1;

    submissionIDReviewMap[submissionId] = { score: totalWeightedScore, recommend: totalWeightedRecommend };
  }

  const parsedResult = {
    IDReviewMap: submissionIDReviewMap,
    scoreList,
    meanScore: scoreList.reduce(sum) / scoreList.length,
    meanConfidence: confidenceList.reduce(sum) / confidenceList.length,
    recommendList,
    scoreDistribution: { labels: scoreDistributionLabels, counts: scoreDistributionCounts },
    recommendDistribution: { labels: recommendDistributionLabels, counts: recommendDistributionCounts }
  };

  return { infoType: 'review', infoData: parsedResult };
};

const getSubmissionInfo = file => {
  // submission.csv
  // data format:
  // submission ID | track ID | track name | title | authors | submit time | last update time | form fields | keywords | decision | notified | reviews sent | abstract
  // File has header
  let content = file.buffer.toString('utf8');
  content =
    'submissionId, trackId, trackName, title, authors, submitTime, lastUpdateTime, formFields, keywords, decision, notified, reviewsSent, abstract\r' +
    content.substring(content.indexOf('\r') + 1);
  const parsedContent = Papa.parse(content, papaConfig);
  if (parsedContent.errors.length !== 0) {
    // error handling
    console.error('parsing has issues:', parsedContent.errors);
    // return false;
  }

  const acceptedSubs = [];
  const rejectedSubs = [];
  const submissionTimes = [];
  const lastUpdateTimes = [];
  const acceptedKeywords = [];
  const rejectedKeywords = [];
  const allKeywords = [];
  const trackNames = [];
  const acceptedAuthorNames = [];
  parsedContent.data.map(row => {
    if (row.decision === 'reject') {
      rejectedSubs.push(row);
      rejectedKeywords.push(...row.keywords.split(/[\r\n]+/).map(x => x.toLowerCase()));
    } else if (row.decision === 'accept') {
      acceptedSubs.push(row);
      acceptedKeywords.push(...row.keywords.split(/[\r\n]+/).map(x => x.toLowerCase()));
      acceptedAuthorNames.push(...row.authors.replace(' and ', ',').split(',').map(x => x.trim()));
    }
    allKeywords.push(...row.keywords.split(/[\r\n]+/).map(x => x.toLowerCase()));
    trackNames.push(row.trackName);
    submissionTimes.push(row.submitTime.split(' ')[0]);
    lastUpdateTimes.push(row.submitTime.split(' ')[0]);
  });

  const acceptedAuthorCount = _.countBy(acceptedAuthorNames);

  const authorNames = [];
  const authorCounts = [];
  util.getSortedArrayFromMapUsingCount(acceptedAuthorCount).map(x => {
    authorNames.push(x[0]);
    authorCounts.push(x[1]);
  });

  const topAcceptedAuthorsMap = {
    names: authorNames,
    counts: authorCounts
  };

  const acceptedKeywordMap = _.countBy(acceptedKeywords);
  const rejectedKeywordMap = _.countBy(rejectedKeywords);
  const overallKeywordMap = _.countBy(allKeywords);

  const acceptedKeywordList = util.getSortedArrayFromMapUsingCount(acceptedKeywordMap);
  const rejectedKeywordList = util.getSortedArrayFromMapUsingCount(rejectedKeywordMap);
  const overallKeywordList = util.getSortedArrayFromMapUsingCount(overallKeywordMap);

  const acceptanceRate = acceptedSubs.length / parsedContent.data.length;
  const subTimeCounts = _.countBy(submissionTimes);
  const updateTimeCounts = _.countBy(lastUpdateTimes);

  const timestamps = util.getSortedArrayFromMapUsingKey(subTimeCounts);
  const lastEditStamps = util.getSortedArrayFromMapUsingKey(updateTimeCounts);

  const timeSeries = [];
  let cumulativeStampCount = 0;
  timestamps.map(element => {
    cumulativeStampCount += element[1];
    timeSeries.push({ x: element[0], y: cumulativeStampCount });
  });

  const lastEditSeries = [];
  let cumulativeEditCount = 0;
  lastEditStamps.map(element => {
    cumulativeEditCount += element[1];
    lastEditSeries.push({ x: element[0], y: cumulativeEditCount });
  });

  // do grouping analysis
  const paperGroupByTrackName = _.mapValues(_.groupBy(parsedContent.data, 'trackName'));

  // Obtained from the JCDL.org website: past conferences
  const comparableAcceptanceRate = {
    year: [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018],
    'Full Papers': [0.29, 0.28, 0.27, 0.29, 0.29, 0.30, 0.29, 0.30],
    'Short Papers': [0.29, 0.37, 0.31, 0.31, 0.32, 0.50, 0.35, 0.32]
  };

  const keywordsByTrack = {};
  const acceptanceRateByTrack = {};
  const topAuthorsByTrack = {};
  for (const paperGroup in paperGroupByTrackName) {
    const acceptedPapersThisTrack = [];
    const acceptedAuthorsThisTrack = [];
    const currentGroupKeywords = [];
    paperGroupByTrackName[paperGroup].map(row => {
      currentGroupKeywords.push(...row.keywords.split(/[\r\n]+/).map(x => x.toLowerCase()));
      if (row.decision === 'accept') {
        acceptedPapersThisTrack.push(row);
        acceptedAuthorsThisTrack.push(...row.authors.replace(' and ', ',').split(',').map(x => x.trim()));
      }
    });
    const countedCurrentGroupKeywords = _.countBy(currentGroupKeywords);
    keywordsByTrack[paperGroup] = util.getSortedArrayFromMapUsingCount(countedCurrentGroupKeywords);
    const acceptedAuthorsThisTrackCount = _.countBy(acceptedAuthorsThisTrack);
    const authorNamesThisTrack = [];
    const authorCountsThisTrack = [];
    util.getSortedArrayFromMapUsingCount(acceptedAuthorsThisTrackCount).map(x => {
      authorNamesThisTrack.push(x[0]);
      authorCountsThisTrack.push(x[1]);
    });

    topAuthorsByTrack[paperGroup] = {
      names: authorNamesThisTrack,
      counts: authorCountsThisTrack
    };

    acceptanceRateByTrack[paperGroup] = acceptedPapersThisTrack.length / paperGroupByTrackName[paperGroup].length;

    if (paperGroup === 'Full Papers' || paperGroup === 'Short Papers') {
      comparableAcceptanceRate[paperGroup].push(acceptedPapersThisTrack.length / paperGroupByTrackName[paperGroup].length);
    }
  }

  const parsedResult = {
    acceptanceRate,
    overallKeywordMap,
    overallKeywordList,
    acceptedKeywordMap,
    acceptedKeywordList,
    rejectedKeywordMap,
    rejectedKeywordList,
    keywordsByTrack,
    acceptanceRateByTrack,
    topAcceptedAuthors: topAcceptedAuthorsMap,
    topAuthorsByTrack,
    timeSeries,
    lastEditSeries,
    comparableAcceptanceRate
  };

  return { infoType: 'submission', infoData: parsedResult };
};

export default {
  getAuthorInfo,
  getReviewInfo,
  getSubmissionInfo
};
