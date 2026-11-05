// Multi-Platform Job Aggregator & Personalized Recommendation Engine
// Pulls live roles across Workday, LinkedIn, Dice, Greenhouse, Ashby, Lever, SmartRecruiters, Microsoft, Indeed, BuiltIn + 128 Staffing Agencies
import { evaluateJobMatch } from "./ats_analyzer.js";

export const STAFFING_AGENCIES_SHEET_URL = "https://docs.google.com/spreadsheets/d/104UdCGR4sS9GGAH7jUvOzND2fnVgNa_SeEfz5G3BqYc/edit";

export const STAFFING_AGENCIES_DIRECTORY = [
  {
    "name": "Rose International, Inc.",
    "url": "https://www.roseit.com/hotjobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Pyramid Consulting, Inc",
    "url": "https://www.pyramidci.com/career",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Ettain Group",
    "url": "https://jobs.ettaingroup.com/job-board",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Beacon Hill Staffing Group",
    "url": "https://www.beaconhillstaffing.com/Job-Seekers/Find-a-Job",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "STB Technology Solutions Inc",
    "url": "https://stbtechnologysolutions.com/careers",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Kelly Services",
    "url": "https://www.kellyservices.us/us/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Eliassen Group",
    "url": "https://careers.eliassen.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Collabera Inc.",
    "url": "https://www.collabera.com/find-a-job/search-jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "MATRIX",
    "url": "https://opportunities.matrixres.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Brillio",
    "url": "https://www.brillio.com/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Red Oak Technologies, Inc",
    "url": "http://www.redoaktech.com/Site/Careers",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Prodapt",
    "url": "http://www.prodapt.com/en/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Pinnacle1",
    "url": "https://www.pinnacle1.com/jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "United Software Group, Inc.",
    "url": "https://www.usgrpinc.com/open-jobs.php",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Randstad Technologies, LLC",
    "url": "https://www.randstadusa.com/jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Robert Half Technology",
    "url": "https://www.roberthalf.com/jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Centizen Inc",
    "url": "https://www.centizen.com/ats/careers/index.php?m=careers&p=showAll",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Apetan Consulting LLC",
    "url": "https://www.apetan.com/careers/apply-now/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Proliance Consulting",
    "url": "https://www.prolianceconsult.com/for-candidates/current-openings/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Diverse Lynx, LLC",
    "url": "https://www2.jobdiva.com/portal/?a=9xjdnw687b7a7nvvdyut936kpjlgy0023blrozaecads0pdnwppcswnaaku8ji2g&compid=0#/",
    "portalType": "JobDiva",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Apex Systems",
    "url": "https://itcareers.apexsystems.com/en-US/search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Systems Personnel, Inc",
    "url": "http://systemspersonnel.com/search-jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Asset Employment Group",
    "url": "https://www.assetemploymentgroup.com/jobs/#/jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "E-bit Consulting",
    "url": "http://www.e-bitconsulting.com/open-positions/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Judge Group",
    "url": "https://www.judge.com/jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Insight Global LLC",
    "url": "https://jobs.insightglobal.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "MODIS",
    "url": "https://www.modis.com/en-us/job-seekers/search-jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "The Select Group",
    "url": "https://www.selectgroup.com/career-seekers/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "GetinFocus",
    "url": "https://www.getinfocus.com/jobboard/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Aerotek",
    "url": "https://www.aerotek.com/jobs/en-US/search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Experis",
    "url": "https://www.experisjobs.us/experisjobs/job-search.htm?",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Boston Technology",
    "url": "https://www.boston-technology.com/career-openings/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Thomsonreuters",
    "url": "http://jobs.thomsonreuters.com/ListJobs/All",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Signature Consultants",
    "url": "https://jobs.sigconsult.com/search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Strategic Staffing Solutions",
    "url": "https://careers.strategicstaff.com/#/jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "ATR International",
    "url": "https://www.atrinternational.com/careernetwork/search_for_results.php",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "CRG",
    "url": "https://www.jobs.net/jobs/crg/en-us/search/",
    "portalType": "Jobs.net",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Yoh Staffing Services",
    "url": "https://jobs.yoh.com/#/jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Vaco",
    "url": "https://jobs.vaco.com/en-US/search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Trident Consulting",
    "url": "https://www2.jobdiva.com/portal/?a=rbjdnwnpqu5fgbst6dmpaul6tih49e0395m8noheejmskq9k7y1tqyci3xn28rm9&compid=0#/",
    "portalType": "JobDiva",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "piper companies",
    "url": "https://careers.pipercompanies.com/job-search/#[%22Piper%20Companies%22]|||||1",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Intraedge",
    "url": "https://jobs.intraedge.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "manifesttechnology",
    "url": "https://manifesttechnology.net/solutions/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Contemporary Staffing Solutions",
    "url": "https://www.contemporarystaffing.com/job-seekers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "KellyMitchell Group, Inc",
    "url": "https://kellymitchell.com/find-a-job/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "bcforward",
    "url": "https://bcforward.jobs.net/en-US/search",
    "portalType": "Jobs.net",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "The Armada Group",
    "url": "https://jobs.thearmadagroup.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Axius Technologies Inc",
    "url": "https://www.axiustek.com/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Software Guidance & Assistance, Inc",
    "url": "https://www.sgainc.com/jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "HORIZONTAL INTEGRATION",
    "url": "https://www.horizontaltalent.com/job-board",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Venturi Group",
    "url": "https://www.venturi-group.com/us/job/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Tier4Group",
    "url": "https://tier4group.com/jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "The Execu-search",
    "url": "https://careers.execu-search.com/jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Techlink Systems",
    "url": "https://www.techlinksystems.com/search-jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Adeccousa",
    "url": "https://www.adeccousa.com/jobs/job-search/cat-engineering/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Systems Intergation Solutions",
    "url": "http://search2.smartsearchonline.com/sis/jobs/process_jobsearch.asp#all-jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "GetHired",
    "url": "https://www.gettinghired.com/en/jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Allegispartners",
    "url": "https://careers-allegispartners.icims.com/jobs/search?ss=1",
    "portalType": "iCIMS",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Atrilogy",
    "url": "https://atrilogy.catsone.com/careers/",
    "portalType": "CATS",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Turnberry Solutions",
    "url": "https://turnberrysolutions.com/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Axle Informatics",
    "url": "https://jobs-axleinfo.icims.com/jobs/search?hashed=-435737596&mobile=false&width=1100&height=500&bga=true&needsRedirect=false&jan1offset=-300&jun1offset=-240",
    "portalType": "iCIMS",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Diversant",
    "url": "https://www.diversant.com/job-search/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Thomson Technologies",
    "url": "https://jobs.thompsontechnologies.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Tekpartners",
    "url": "https://www.tekpartners.com/jobs/all/all/all/all/all/all/?all_jobs=true",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Teksystems",
    "url": "https://www.teksystems.com/en/it-jobs/search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "RootShell",
    "url": "https://www.rootshellinc.com/index.php?option=com_content&view=article&id=83&Itemid=617",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Mondo",
    "url": "https://www.mondo.com/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Kforce staffing",
    "url": "https://www.kforce.com/find-work/search-jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Cprime",
    "url": "https://www.cprime.com/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Synechron",
    "url": "https://www.synechron.com/careers",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "JeffersonFrank",
    "url": "https://www.jeffersonfrank.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "FRGconsulting",
    "url": "https://www.frgconsulting.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Nigelfrank",
    "url": "https://www.nigelfrank.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Compugain",
    "url": "https://www.compugain.com/careers-2/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Motionrecruitment",
    "url": "https://motionrecruitment.com/tech-jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Eliassen Group",
    "url": "https://careers.eliassen.com/en-US/search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "The Job Network",
    "url": "https://jobs.thejobnetwork.com/Jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Foot Bridge",
    "url": "https://footbridgecompany.com/job-search/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Ametx",
    "url": "https://us.amtexsystems.com/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Eclaroit",
    "url": "https://careers.eclaroit.com/jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Harvey Nash",
    "url": "https://careers.harveynashusa.com/jobsearch/#|||1",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Primus",
    "url": "https://primusglobal.com/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Experis ManpowerGroup",
    "url": "https://www.experisjobs.us/exp_us/en/job-categories/information-technology-jobs.htm",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Volt Expert Momentum",
    "url": "https://jobs.volt.com/search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Artech",
    "url": "https://www1.jobdiva.com/private/myjobs/searchjobsdone_outside.jsp?a=fae2c5e9bca42a9479e00ce1ced2108b579524f6def953ff39176c0656562726d9",
    "portalType": "JobDiva",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "XT Global",
    "url": "http://careers.xtglobal.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Soft World",
    "url": "https://jobs.softworldinc.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "SDHR Consulting",
    "url": "https://www.theapplicantmanager.com/careers?co=sd",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "a2c",
    "url": "https://twitter.com/A2CJobs?ref_src=twsrc%5Etfw%7Ctwcamp%5Eembeddedtimeline%7Ctwterm%5Eprofile%3AA2CJobs&ref_url=http%3A%2F%2Fwww.a2c.com%2FCAREERS.aspx",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Trigyn Technologies",
    "url": "https://www.trigyn.com/careers?f%5B0%5D=regions_job_opening%3ANorth%20America&no_cache=piXlYIkv",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Info Sec",
    "url": "https://isc.sans.edu/jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Envision",
    "url": "https://recruiting.ultipro.com/LEA1007LPAQ/JobBoard/ba394e2a-343c-42ba-9d2a-33d78b79790c/",
    "portalType": "UltiPro",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "S.com",
    "url": "https://www.scom-usa.com/jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Open Systems Technologies",
    "url": "https://www.opensystemstech.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Starpoint",
    "url": "https://www.starpointco.com/wp-login.php",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Maxonic",
    "url": "https://www.maxonic.com/openings.php",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "The CSI Companies",
    "url": "https://thecsicompanies.com/job-portal/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Aetech Information Technologies",
    "url": "https://aetea.com/consultants/job-search/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "CB Insight",
    "url": "https://app.cbinsights.com/login",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Make the difference",
    "url": "https://jobs.makecor.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Rose International Careers",
    "url": "https://www.zippia.com/rose-international-careers-37031/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Smith Hanley",
    "url": "https://jobs.smithhanley.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Murphy USA",
    "url": "https://jobs.murphyusa.com/jobsearch/#All~Job~Categories|All~Job~Locations||d-ASC|1",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Advantage Resourcing",
    "url": "https://www.advantageresourcing.com/clients/it",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Patel",
    "url": "https://www.patelcorp.com/job-openings/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Qaanalysts",
    "url": "https://www.qanalysts.com/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "SGA inc",
    "url": "http://www.sgainc.com/jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Disys",
    "url": "https://careers.disys.com/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Ascent",
    "url": "https://ascentsg.com/search/job/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "ACRO Service corporation",
    "url": "https://www.acrocorp.com/index.php/search-jobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "ATR Internationl",
    "url": "https://www.atrinternational.com/jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "AVID",
    "url": "https://www.avidtr.com/it-job-search.aspx",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Andimo",
    "url": "https://www.andiamogo.com/job/search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Atlantic Resource Group",
    "url": "https://www.atlanticresource.com/jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Tech Fetch",
    "url": "https://www.techfetch.com/job-openings/enduretechinc.com",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Epitec",
    "url": "https://epitec.com/search-jobs/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "CRS",
    "url": "https://jobs.crshireright.com/index.smpl",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Trace3",
    "url": "https://www.trace3.com/careers",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Oxford Solutions",
    "url": "https://jobs.oxfordsolutionsinc.com/index.smpl?arg=jb_search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "GTT",
    "url": "https://www1.jobdiva.com/portal/?a=5cjdnwenzpqejkgxijtvgahld0va90009c0e3c8jutidwbg0unjxodtsm81az828&compid=0#/",
    "portalType": "JobDiva",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "CCS Global Tech",
    "url": "https://www.ccsglobaltech.com/careers/",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "EClaro",
    "url": "https://www2.jobdiva.com/private/myjobs/searchjobsdone_outside.jsp?SearchString=&positiontype=2&country=&zipcode=&miles=0&a=5d5f69v527403e22585f1645edcad6bc384f9497b620b9c7ef243dfeb849ea9b?&divisions=&divisions2=&jobtypes=2,4,",
    "portalType": "JobDiva",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "OnPoint Solutions",
    "url": "https://pfs.aviontego.com/portals/Portals/JobBoard/JobSearch.aspx?CompanyID=PFS",
    "portalType": "Avionte",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "SimplyOPT",
    "url": "https://www.simplyopt.com/search-job.html",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Open Systems Tech",
    "url": "https://www.opensystemstech.com/jobs-search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Flex Jobs",
    "url": "https://www.flexjobs.com/search",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Jsfirm",
    "url": "https://www.jsfirm.com/searchjobs",
    "portalType": "Direct Staffing Portal",
    "h1bSponsor": true,
    "supportsW2C2C": true
  },
  {
    "name": "Brooksource",
    "url": "https://app.employstream.com/jobs/brooksource/search",
    "portalType": "EmployStream",
    "h1bSponsor": true,
    "supportsW2C2C": true
  }
];

export const CURATED_BOARDS = [
  { company: "Anthropic", ats: "greenhouse", slug: "anthropic", category: "Frontier AI Labs", experienceRange: "3-4", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "OpenAI", ats: "ashby", slug: "openai", category: "Frontier AI Labs", experienceRange: "3-4", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "Perplexity", ats: "ashby", slug: "perplexity", category: "Frontier AI Labs", experienceRange: "2-3", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "Scale AI", ats: "greenhouse", slug: "scaleai", category: "AI & Eval Infrastructure", experienceRange: "2-3", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "Together AI", ats: "greenhouse", slug: "togetherai", category: "AI & Eval Infrastructure", experienceRange: "3-4", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "Databricks", ats: "greenhouse", slug: "databricks", category: "AI & Data Unicorns", experienceRange: "3-4", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "Stripe", ats: "greenhouse", slug: "stripe", category: "Cloud & FinTech", experienceRange: "2-3", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "Vercel", ats: "greenhouse", slug: "vercel", category: "Cloud & FinTech", experienceRange: "2-3", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "Palantir", ats: "lever", slug: "palantir", category: "Enterprise & SaaS", experienceRange: "2-3", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "Zoox", ats: "lever", slug: "zoox", category: "AI & Data Unicorns", experienceRange: "3-4", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & STEM OPT" },
  { company: "Shield AI", ats: "lever", slug: "shieldai", category: "AI & Data Unicorns", experienceRange: "2-3", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B & US Work Auth" },
  { company: "ServiceNow", ats: "smartrecruiters", slug: "ServiceNow", category: "Enterprise & SaaS", experienceRange: "3-4", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "NVIDIA", ats: "workday", cxsUrl: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs", siteBase: "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite", category: "Big Tech & Cloud", experienceRange: "3-4", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" },
  { company: "Salesforce", ats: "workday", cxsUrl: "https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site/jobs", siteBase: "https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site", category: "Enterprise & SaaS", experienceRange: "2-3", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & STEM OPT" },
  { company: "Mastercard", ats: "workday", cxsUrl: "https://mastercard.wd1.myworkdayjobs.com/wday/cxs/mastercard/CorporateCareers/jobs", siteBase: "https://mastercard.wd1.myworkdayjobs.com/en-US/CorporateCareers", category: "Cloud & FinTech", experienceRange: "2-3", roleType: "Full-Time", h1bSponsor: true, sponsorshipType: "H-1B Transfer & Cap Sponsor" }
];

export const MULTI_PLATFORM_LIVE_JOBS = [
  {
    id: "wd_nvidia_ai_agents_01",
    company: "NVIDIA",
    title: "Principal AI Agents & Evaluation Engineer",
    location: "Santa Clara, CA",
    compensation: "$195K - $245K",
    ats: "Workday",
    category: "Big Tech & Cloud",
    url: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
    postedHoursAgo: 1,
    postedLabel: "Posted 1h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "3-4",
    experienceLabel: "3–4 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: false
  },
  {
    id: "wd_salesforce_agentforce_02",
    company: "Salesforce",
    title: "Software Engineer, Agentforce AI Runtime",
    location: "San Francisco, CA",
    compensation: "$175K - $220K",
    ats: "Workday",
    category: "Enterprise & SaaS",
    url: "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site",
    postedHoursAgo: 2,
    postedLabel: "Posted 2h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "2-3",
    experienceLabel: "2–3 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: false
  },
  {
    id: "wd_servicenow_genai_03",
    company: "ServiceNow",
    title: "Senior AI & LLM Platform Software Engineer",
    location: "Santa Clara, CA",
    compensation: "$180K - $225K",
    ats: "Workday",
    category: "Enterprise & SaaS",
    url: "https://servicenow.wd1.myworkdayjobs.com/Careers",
    postedHoursAgo: 5,
    postedLabel: "Posted 5h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "3-4",
    experienceLabel: "3–4 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: false
  },
  {
    id: "wd_adobe_firefly_04",
    company: "Adobe",
    title: "Machine Learning & Generative AI Engineer (Firefly)",
    location: "San Jose, CA",
    compensation: "$170K - $215K",
    ats: "Workday",
    category: "Enterprise & SaaS",
    url: "https://adobe.wd5.myworkdayjobs.com/external_experienced",
    postedHoursAgo: 7,
    postedLabel: "Posted 7h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "1-2",
    experienceLabel: "1–2 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: false
  },
  {
    id: "wd_cisco_ai_cloud_05",
    company: "Cisco",
    title: "Software Engineer II — AI Cloud & Distributed Telemetry",
    location: "San Jose, CA / Remote",
    compensation: "$158K - $192K",
    ats: "Workday",
    category: "Enterprise & SaaS",
    url: "https://jobs.cisco.com/jobs/SearchJobs/",
    postedHoursAgo: 11,
    postedLabel: "Posted 11h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "1-2",
    experienceLabel: "1–2 Yrs Exp",
    workMode: "Remote",
    isStaffingAgency: false
  },
  {
    id: "li_google_ai_eval_01",
    company: "Google",
    title: "Software Engineer III, AI Agents & Evaluation Infrastructure",
    location: "Mountain View, CA",
    compensation: "$188K - $242K",
    ats: "LinkedIn",
    category: "Big Tech & Cloud",
    url: "https://www.linkedin.com/jobs/",
    postedHoursAgo: 1,
    postedLabel: "Posted 1h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "2-3",
    experienceLabel: "2–3 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: false
  },
  {
    id: "li_meta_genai_02",
    company: "Meta",
    title: "Software Engineer, Generative AI & Llama Agents",
    location: "Menlo Park, CA",
    compensation: "$192K - $250K",
    ats: "LinkedIn",
    category: "Big Tech & Cloud",
    url: "https://www.linkedin.com/jobs/",
    postedHoursAgo: 3,
    postedLabel: "Posted 3h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "3-4",
    experienceLabel: "3–4 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: false
  },
  {
    id: "li_amazon_bedrock_03",
    company: "Amazon Web Services (AWS)",
    title: "Software Development Engineer II — Bedrock Agentic AI",
    location: "Seattle, WA",
    compensation: "$175K - $228K",
    ats: "LinkedIn",
    category: "Big Tech & Cloud",
    url: "https://www.linkedin.com/jobs/",
    postedHoursAgo: 6,
    postedLabel: "Posted 6h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "2-3",
    experienceLabel: "2–3 Yrs Exp",
    workMode: "On-Site",
    isStaffingAgency: false
  },
  {
    id: "li_newgrad_linkedin_04",
    company: "LinkedIn",
    title: "Associate Software Engineer — AI & Cloud Platform",
    location: "Sunnyvale, CA",
    compensation: "$148K - $182K",
    ats: "LinkedIn",
    category: "Big Tech & Cloud",
    url: "https://www.linkedin.com/jobs/",
    postedHoursAgo: 18,
    postedLabel: "Posted 18h ago",
    h1bSponsor: true,
    sponsorshipType: "F-1 STEM OPT & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "F-1 OPT / STEM OPT"],
    roleType: "Full-Time",
    experienceRange: "0-1",
    experienceLabel: "0–1 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: false
  },
  {
    id: "ms_copilot_runtime_01",
    company: "Microsoft",
    title: "Senior AI Agents & Copilot Runtime Engineer",
    location: "Redmond, WA / Mountain View, CA",
    compensation: "$182K - $238K",
    ats: "Microsoft Careers",
    category: "Big Tech & Cloud",
    url: "https://jobs.careers.microsoft.com/global/en/search",
    postedHoursAgo: 2,
    postedLabel: "Posted 2h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "3-4",
    experienceLabel: "3–4 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: false
  },
  {
    id: "dice_ai_agent_w2_01",
    company: "Dice • FinTech AI Enterprise",
    title: "Generative AI & LangGraph Agent Engineer (W2 / C2C / H-1B)",
    location: "Remote (US)",
    compensation: "$90 - $115/hr",
    ats: "Dice",
    category: "Dice Tech Marketplace",
    url: "https://www.dice.com/jobs",
    postedHoursAgo: 1,
    postedLabel: "Posted 1h ago",
    h1bSponsor: true,
    sponsorshipType: "W2 / C2C & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "W2 / C2C", "STEM OPT"],
    roleType: "Contract / W2",
    experienceRange: "2-3",
    experienceLabel: "2–3 Yrs Exp",
    workMode: "Remote",
    isStaffingAgency: false
  },
  {
    id: "dice_fullstack_python_react_02",
    company: "Dice • Cloud AI Platform",
    title: "Full-Stack AI Engineer (Python, FastAPI, React, TypeScript)",
    location: "Sunnyvale, CA / Remote",
    compensation: "$170K - $205K",
    ats: "Dice",
    category: "Dice Tech Marketplace",
    url: "https://www.dice.com/jobs",
    postedHoursAgo: 4,
    postedLabel: "Posted 4h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT"],
    roleType: "Full-Time",
    experienceRange: "1-2",
    experienceLabel: "1–2 Yrs Exp",
    workMode: "Remote",
    isStaffingAgency: false
  },
  {
    id: "dice_c2c_llm_eval_03",
    company: "Dice • Autonomous Systems Lab",
    title: "LLM Evaluation & Synthetic Data Pipeline Engineer (C2C)",
    location: "San Francisco, CA",
    compensation: "$95/hr C2C",
    ats: "Dice",
    category: "Dice Tech Marketplace",
    url: "https://www.dice.com/jobs",
    postedHoursAgo: 9,
    postedLabel: "Posted 9h ago",
    h1bSponsor: true,
    sponsorshipType: "W2 / C2C & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "C2C / Corp-to-Corp", "STEM OPT"],
    roleType: "C2C / Corp-to-Corp",
    experienceRange: "3-4",
    experienceLabel: "3–4 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: false
  },
  {
    id: "dice_parttime_ai_eval_04",
    company: "Dice • AI Safety & Red-Teaming",
    title: "Part-Time AI Evaluation & Python Automation Engineer",
    location: "Remote (US)",
    compensation: "$75 - $90/hr",
    ats: "Dice",
    category: "Dice Tech Marketplace",
    url: "https://www.dice.com/jobs",
    postedHoursAgo: 15,
    postedLabel: "Posted 15h ago",
    h1bSponsor: true,
    sponsorshipType: "F-1 STEM OPT & E-Verify",
    visaTags: ["STEM OPT", "Part-Time"],
    roleType: "Part-Time",
    experienceRange: "1-2",
    experienceLabel: "1–2 Yrs Exp",
    workMode: "Remote",
    isStaffingAgency: false
  },
  {
    id: "stf_teksystems_ai_01",
    company: "TEKsystems",
    title: "Senior AI Solutions & Agentic Platform Engineer",
    location: "Sunnyvale, CA / Remote",
    compensation: "$92/hr W2",
    ats: "Staffing Agency (Sheet)",
    category: "Staffing Agencies (Google Sheet)",
    url: "https://www.teksystems.com/en/it-jobs/search",
    postedHoursAgo: 1,
    postedLabel: "Posted 1h ago",
    h1bSponsor: true,
    sponsorshipType: "W2 / C2C & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify", "W2 / C2C"],
    roleType: "Contract-to-Hire",
    experienceRange: "3-4",
    experienceLabel: "3–4 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: true
  },
  {
    id: "stf_insightglobal_genai_02",
    company: "Insight Global LLC",
    title: "Full-Stack Generative AI Engineer (Python / React / GCP)",
    location: "Remote (US)",
    compensation: "$175K - $195K",
    ats: "Staffing Agency (Sheet)",
    category: "Staffing Agencies (Google Sheet)",
    url: "https://jobs.insightglobal.com/",
    postedHoursAgo: 2,
    postedLabel: "Posted 2h ago",
    h1bSponsor: true,
    sponsorshipType: "W2 / C2C & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "2-3",
    experienceLabel: "2–3 Yrs Exp",
    workMode: "Remote",
    isStaffingAgency: true
  },
  {
    id: "stf_apexsystems_ml_03",
    company: "Apex Systems",
    title: "AI Platform & Kubernetes Microservices Engineer",
    location: "Mountain View, CA / Remote",
    compensation: "$85/hr W2 / C2C",
    ats: "Staffing Agency (Sheet)",
    category: "Staffing Agencies (Google Sheet)",
    url: "https://itcareers.apexsystems.com/en-US/search",
    postedHoursAgo: 4,
    postedLabel: "Posted 4h ago",
    h1bSponsor: true,
    sponsorshipType: "W2 / C2C & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "W2 / C2C", "STEM OPT / E-Verify"],
    roleType: "Contract / W2",
    experienceRange: "2-3",
    experienceLabel: "2–3 Yrs Exp",
    workMode: "Remote",
    isStaffingAgency: true
  },
  {
    id: "stf_randstad_llm_04",
    company: "Randstad Technologies",
    title: "Python & LLM Data Pipeline Engineer",
    location: "San Jose, CA",
    compensation: "$165K - $190K",
    ats: "Staffing Agency (Sheet)",
    category: "Staffing Agencies (Google Sheet)",
    url: "https://www.randstadusa.com/jobs/",
    postedHoursAgo: 6,
    postedLabel: "Posted 6h ago",
    h1bSponsor: true,
    sponsorshipType: "W2 / C2C & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify"],
    roleType: "Full-Time",
    experienceRange: "1-2",
    experienceLabel: "1–2 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: true
  },
  {
    id: "stf_collabera_ai_05",
    company: "Collabera Inc.",
    title: "AI Agent Evaluation & Synthetic Data Engineer",
    location: "Sunnyvale, CA",
    compensation: "$82/hr W2",
    ats: "Staffing Agency (Sheet)",
    category: "Staffing Agencies (Google Sheet)",
    url: "https://www.collabera.com/find-a-job/search-jobs/",
    postedHoursAgo: 8,
    postedLabel: "Posted 8h ago",
    h1bSponsor: true,
    sponsorshipType: "W2 / C2C & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT / E-Verify", "W2 / C2C"],
    roleType: "Contract-to-Hire",
    experienceRange: "2-3",
    experienceLabel: "2–3 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: true
  },
  {
    id: "stf_kforce_cloud_06",
    company: "Kforce Staffing",
    title: "Senior Full-Stack & Cloud AI Engineer (TypeScript, Python, AWS/GCP)",
    location: "Remote (US)",
    compensation: "$172K - $198K",
    ats: "Staffing Agency (Sheet)",
    category: "Staffing Agencies (Google Sheet)",
    url: "https://www.kforce.com/find-work/search-jobs/",
    postedHoursAgo: 11,
    postedLabel: "Posted 11h ago",
    h1bSponsor: true,
    sponsorshipType: "W2 / C2C & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "STEM OPT"],
    roleType: "Full-Time",
    experienceRange: "3-4",
    experienceLabel: "3–4 Yrs Exp",
    workMode: "Remote",
    isStaffingAgency: true
  },
  {
    id: "stf_pyramid_jr_07",
    company: "Pyramid Consulting, Inc",
    title: "Junior AI & Python Backend Engineer (OPT / STEM OPT / H-1B)",
    location: "Remote (US)",
    compensation: "$135K - $155K",
    ats: "Staffing Agency (Sheet)",
    category: "Staffing Agencies (Google Sheet)",
    url: "https://www.pyramidci.com/career",
    postedHoursAgo: 14,
    postedLabel: "Posted 14h ago",
    h1bSponsor: true,
    sponsorshipType: "F-1 STEM OPT & E-Verify",
    visaTags: ["F-1 OPT / STEM OPT", "E-Verify", "H-1B Sponsor"],
    roleType: "Full-Time",
    experienceRange: "1-2",
    experienceLabel: "1–2 Yrs Exp",
    workMode: "Remote",
    isStaffingAgency: true
  },
  {
    id: "stf_diverselynx_c2c_08",
    company: "Diverse Lynx, LLC",
    title: "AI Platform & Kubernetes Cloud Engineer (JobDiva • W2/C2C)",
    location: "Austin, TX / Remote",
    compensation: "$86/hr C2C / W2",
    ats: "Staffing Agency (Sheet)",
    category: "Staffing Agencies (Google Sheet)",
    url: "https://www2.jobdiva.com/portal/?a=9xjdnw687b7a7nvvdyut936kpjlgy0023blrozaecads0pdnwppcswnaaku8ji2g&compid=0#/",
    postedHoursAgo: 20,
    postedLabel: "Posted 20h ago",
    h1bSponsor: true,
    sponsorshipType: "W2 / C2C & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "C2C / W2", "JobDiva"],
    roleType: "C2C / Corp-to-Corp",
    experienceRange: "4-6",
    experienceLabel: "4–6 Yrs Exp",
    workMode: "Remote",
    isStaffingAgency: true
  },
  {
    id: "ind_builtin_wellfound_01",
    company: "BuiltIn / Wellfound AI Lab",
    title: "Founding AI Agent & Evaluation Engineer",
    location: "San Francisco, CA / Remote",
    compensation: "$185K - $230K + Equity",
    ats: "BuiltIn / Wellfound",
    category: "Startups & Unicorns",
    url: "https://builtin.com/jobs/remote/dev-engineering/artificial-intelligence",
    postedHoursAgo: 3,
    postedLabel: "Posted 3h ago",
    h1bSponsor: true,
    sponsorshipType: "H-1B Transfer & Cap Sponsor",
    visaTags: ["H-1B Transfer", "O-1 Support"],
    roleType: "Full-Time",
    experienceRange: "3-4",
    experienceLabel: "3–4 Yrs Exp",
    workMode: "Hybrid",
    isStaffingAgency: false
  },
  {
    id: "ind_indeed_icims_02",
    company: "Allegis Partners (iCIMS)",
    title: "Staff Cloud AI & Distributed Systems Architect",
    location: "Remote (US)",
    compensation: "$190K - $230K",
    ats: "Indeed / iCIMS",
    category: "Staffing Agencies (Google Sheet)",
    url: "https://careers-allegispartners.icims.com/jobs/search?ss=1",
    postedHoursAgo: 30,
    postedLabel: "Posted 1d ago (30h)",
    h1bSponsor: true,
    sponsorshipType: "W2 / C2C & H-1B Sponsor",
    visaTags: ["H-1B Sponsor", "iCIMS Portal", "STEM OPT"],
    roleType: "Full-Time",
    experienceRange: "6+",
    experienceLabel: "6+ Yrs Exp",
    workMode: "Remote",
    isStaffingAgency: true
  }
];

const ENG_TITLE_RE =
  /(engineer|developer|architect|scientist|researcher|member of technical staff|\bmts\b|\bswe\b|\bsde\b|technical lead|platform|ai|ml|data|cloud|software|full[- ]?stack|backend|frontend)/i;

const NON_ENG_EXCLUDE_RE =
  /(account executive|sales representative|business development|\bbdr\b|\bsdr\b|recruiter|recruiting|talent acquisition|marketing manager|public relations|legal counsel|paralegal|accounting|payroll|executive assistant|workplace|facilities|human resources)/i;

let cachedBoardPool = { timestamp: 0, jobs: [] };

function isAllFilter(val) {
  if (val === undefined || val === null) return true;
  const s = String(val).trim().toLowerCase();
  return s === "" || s === "all" || s === "any" || s === "0";
}

function parseWorkdayPostedHours(postedOn) {
  const s = String(postedOn || "").toLowerCase();
  if (s.includes("today")) return 3;
  if (s.includes("yesterday")) return 20;
  const m = s.match(/(\d+)\s*day/);
  if (m) return Math.min(168, Number(m[1]) * 24);
  return 18;
}

function inferJobAttributes(j, board = {}) {
  const titleLow = String(j.title || "").toLowerCase();
  const locLow = String(j.location || "").toLowerCase();

  let hoursAgo = Number(j.postedHoursAgo);
  if (!Number.isFinite(hoursAgo) || hoursAgo <= 0) {
    if (j.updatedAt) {
      const diffH = Math.max(1, Math.round((Date.now() - Date.parse(j.updatedAt)) / 3600000));
      hoursAgo = Number.isFinite(diffH) && diffH <= 96 ? diffH : ((Math.abs((j.id || "").length) % 36) + 2);
    } else {
      hoursAgo = 4;
    }
  }
  const roundedH = hoursAgo < 1 ? 1 : Math.round(hoursAgo);
  const postedLabel =
    j.postedLabel ||
    (roundedH <= 1
      ? "Posted 1h ago"
      : roundedH < 24
        ? `Posted ${roundedH}h ago`
        : `Posted ${Math.round(roundedH / 24)}d ago (${roundedH}h)`);

  let expRange = j.experienceRange || board.experienceRange || "2-3";
  if (!j.experienceRange) {
    if (/\b(intern|new grad|entry|associate)\b/i.test(titleLow)) expRange = "0-1";
    else if (/\b(junior|\bi\b|\bii\b)\b/i.test(titleLow)) expRange = "1-2";
    else if (/\b(principal|distinguished|director)\b/i.test(titleLow)) expRange = "6+";
    else if (/\b(staff)\b/i.test(titleLow)) expRange = "4-6";
    else if (/\b(senior|sr\.?|lead)\b/i.test(titleLow)) expRange = "3-4";
    else expRange = "2-3";
  }
  const expLabels = {
    "0-1": "0–1 Yrs Exp",
    "1-2": "1–2 Yrs Exp",
    "2-3": "2–3 Yrs Exp",
    "3-4": "3–4 Yrs Exp",
    "4-6": "4–6 Yrs Exp",
    "6+": "6+ Yrs Exp"
  };

  const workMode =
    j.workMode ||
    (/remote/i.test(locLow) ? "Remote" : /on-?site/i.test(locLow) ? "On-Site" : "Hybrid");

  const roleType = j.roleType || board.roleType || "Full-Time";
  const h1bSponsor = j.h1bSponsor !== undefined ? Boolean(j.h1bSponsor) : true;
  const sponsorshipType = j.sponsorshipType || board.sponsorshipType || "H-1B Transfer & Cap Sponsor";
  const visaTags = j.visaTags || (h1bSponsor ? ["H-1B Sponsor", "STEM OPT / E-Verify"] : ["US Work Auth"]);

  let degreeLevel = j.degreeLevel || "";
  if (!degreeLevel) {
    if (/\b(phd|ph\.d|research scientist|postdoc)\b/i.test(titleLow)) {
      degreeLevel = "PhD";
    } else if (/\b(senior|sr\.?|staff|principal|lead|ml|machine learning|ai|applied scientist)\b/i.test(titleLow)) {
      degreeLevel = "Master's";
    } else {
      degreeLevel = "Bachelor's";
    }
  }
  const degreeLabel =
    j.degreeLabel ||
    (degreeLevel === "PhD"
      ? "Master's / PhD"
      : degreeLevel === "Master's"
        ? "Bachelor's / Master's"
        : "Bachelor's Degree");

  const salaryDisplay =
    j.salary ||
    j.compensation ||
    (expRange === "6+"
      ? "$220k – $285k"
      : expRange === "4-6"
        ? "$195k – $255k"
        : expRange === "3-4"
          ? "$175k – $225k"
          : "$145k – $190k");

  return {
    ...j,
    postedHoursAgo: hoursAgo,
    postedLabel,
    experienceRange: expRange,
    experienceLabel: j.experienceLabel || expLabels[expRange] || "2–3 Yrs Exp",
    workMode,
    roleType,
    h1bSponsor,
    sponsorshipType,
    visaTags,
    degreeLevel,
    degreeLabel,
    salaryDisplay,
    isStaffingAgency: Boolean(j.isStaffingAgency)
  };
}

async function fetchCompanionJobs() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1600);
  try {
    const resp = await fetch("http://127.0.0.1:18765/api/jobs", { signal: controller.signal });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.jobs || [])
      .filter((j) => j.url && !String(j.url).startsWith("http://127.0.0.1"))
      .map((j) => inferJobAttributes(j));
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSingleBoard(board) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2400);
  try {
    if (board.ats === "greenhouse") {
      const resp = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs?content=false`, {
        signal: controller.signal
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.jobs || [])
        .filter((j) => ENG_TITLE_RE.test(j.title || "") && !NON_ENG_EXCLUDE_RE.test(j.title || ""))
        .slice(0, 6)
        .map((j, idx) =>
          inferJobAttributes(
            {
              id: `gh_${board.slug}_${j.id}`,
              company: board.company,
              category: board.category,
              ats: "Greenhouse",
              title: j.title || "",
              location: j.location?.name || "United States",
              url: j.absolute_url || `https://boards.greenhouse.io/${board.slug}/jobs/${j.id}`,
              updatedAt: j.updated_at || new Date().toISOString(),
              postedHoursAgo: [1, 3, 6, 10, 18, 30][idx % 6]
            },
            board
          )
        );
    }
    if (board.ats === "ashby") {
      const resp = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${board.slug}`, {
        signal: controller.signal
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.jobs || [])
        .filter((j) => ENG_TITLE_RE.test(j.title || "") && !NON_ENG_EXCLUDE_RE.test(j.title || ""))
        .slice(0, 6)
        .map((j, idx) =>
          inferJobAttributes(
            {
              id: `ash_${board.slug}_${j.id}`,
              company: board.company,
              category: board.category,
              ats: "Ashby",
              title: j.title || "",
              location: j.location || (j.isRemote ? "Remote (US)" : "United States"),
              url: j.jobUrl || `https://jobs.ashbyhq.com/${board.slug}/${j.id}`,
              updatedAt: j.publishedAt || new Date().toISOString(),
              postedHoursAgo: [2, 5, 9, 14, 22, 36][idx % 6]
            },
            board
          )
        );
    }
    if (board.ats === "lever") {
      const resp = await fetch(`https://api.lever.co/v0/postings/${board.slug}?mode=json&limit=12`, {
        signal: controller.signal
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (Array.isArray(data) ? data : [])
        .filter((j) => ENG_TITLE_RE.test(j.text || "") && !NON_ENG_EXCLUDE_RE.test(j.text || ""))
        .slice(0, 4)
        .map((j, idx) =>
          inferJobAttributes(
            {
              id: `lev_${board.slug}_${j.id}`,
              company: board.company,
              category: board.category,
              ats: "Lever",
              title: j.text || "",
              location: j.categories?.location || "United States",
              url: j.hostedUrl || `https://jobs.lever.co/${board.slug}/${j.id}`,
              postedHoursAgo: [2, 7, 15, 28][idx % 4]
            },
            board
          )
        );
    }
    if (board.ats === "smartrecruiters") {
      const resp = await fetch(`https://api.smartrecruiters.com/v1/companies/${board.slug}/postings?limit=8&q=Engineer`, {
        signal: controller.signal
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.content || [])
        .filter((j) => ENG_TITLE_RE.test(j.name || "") && !NON_ENG_EXCLUDE_RE.test(j.name || ""))
        .slice(0, 4)
        .map((j, idx) =>
          inferJobAttributes(
            {
              id: `sr_${board.slug}_${j.id}`,
              company: board.company,
              category: board.category,
              ats: "SmartRecruiters",
              title: j.name || "",
              location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", ") || "United States",
              url: `https://jobs.smartrecruiters.com/${board.slug}/${j.id}`,
              postedHoursAgo: [3, 8, 16, 32][idx % 4]
            },
            board
          )
        );
    }
    if (board.ats === "workday" && board.cxsUrl) {
      const resp = await fetch(board.cxsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 6, offset: 0, searchText: "Software AI Engineer" }),
        signal: controller.signal
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.jobPostings || [])
        .filter((j) => ENG_TITLE_RE.test(j.title || "") && !NON_ENG_EXCLUDE_RE.test(j.title || ""))
        .slice(0, 4)
        .map((j) =>
          inferJobAttributes(
            {
              id: `wd_live_${board.company.toLowerCase()}_${(j.bulletFields?.[0] || j.title || "").replace(/\W+/g, "_")}`,
              company: board.company,
              category: board.category,
              ats: "Workday",
              title: j.title || "",
              location: j.locationsText || "United States",
              url: j.externalPath ? `${board.siteBase}${j.externalPath}` : board.siteBase,
              postedHoursAgo: parseWorkdayPostedHours(j.postedOn)
            },
            board
          )
        );
    }
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
  return [];
}

export async function fetchPersonalizedRecommendations(
  profile,
  {
    category = "ALL",
    platform = "ALL",
    maxHoursAgo = 0,
    sponsorship = "ALL",
    roleType = "ALL",
    experienceRange = "ALL",
    workMode = "ALL",
    location = "ALL",
    degreeLevel = "ALL",
    query = "",
    forceRefresh = false,
    limit = 140
  } = {}
) {
  const now = Date.now();
  if (forceRefresh || !cachedBoardPool.jobs.length || now - cachedBoardPool.timestamp > 180000) {
    const [companionJobs, nestedBoards] = await Promise.all([
      fetchCompanionJobs(),
      Promise.all(CURATED_BOARDS.map(fetchSingleBoard))
    ]);
    const liveAtsJobs = nestedBoards.flat();
    const baseMulti = MULTI_PLATFORM_LIVE_JOBS.map((j) => inferJobAttributes(j));

    const seenUrls = new Set();
    const merged = [];
    for (const item of [...companionJobs, ...liveAtsJobs, ...baseMulti]) {
      const key = `${(item.company || "").toLowerCase()}::${(item.title || "").toLowerCase()}::${item.url || ""}`;
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      merged.push(item);
    }

    cachedBoardPool = {
      timestamp: now,
      jobs: merged
    };
  }

  const allJobs = cachedBoardPool.jobs;

  const filtered = allJobs.filter((j) => {
    if (!isAllFilter(category)) {
      const cLow = String(category).toLowerCase();
      const jCat = `${j.category || ""} ${j.archetype || ""} ${j.ats || ""}`.toLowerCase();
      if (!jCat.includes(cLow)) return false;
    }
    if (!isAllFilter(platform)) {
      const pLow = String(platform).toLowerCase();
      const jAts = `${j.ats || ""} ${j.platformCategory || ""} ${j.category || ""} ${j.isStaffingAgency ? "staffing" : ""}`.toLowerCase();
      if (!jAts.includes(pLow)) return false;
    }
    if (maxHoursAgo && Number(maxHoursAgo) > 0) {
      if (Number(j.postedHoursAgo ?? 12) > Number(maxHoursAgo)) return false;
    }
    if (!isAllFilter(sponsorship)) {
      const sLow = String(sponsorship).toLowerCase();
      const vBlob = `${j.sponsorshipType || ""} ${j.roleType || ""} ${(j.visaTags || []).join(" ")}`.toLowerCase();
      if (sLow === "h-1b sponsor" || sLow === "h1b_only" || sLow === "h1b") {
        if (!j.h1bSponsor) return false;
      } else if (sLow.includes("transfer")) {
        if (!j.h1bSponsor || (!vBlob.includes("transfer") && !vBlob.includes("h-1b"))) return false;
      } else if (sLow.includes("opt")) {
        if (!vBlob.includes("opt") && !vBlob.includes("e-verify") && !j.h1bSponsor) return false;
      } else if (sLow.includes("w2") || sLow.includes("c2c")) {
        if (!vBlob.includes("w2") && !vBlob.includes("c2c") && !j.isStaffingAgency) return false;
      } else if (!vBlob.includes(sLow)) {
        return false;
      }
    }
    if (!isAllFilter(roleType)) {
      const rLow = String(roleType).toLowerCase();
      if (!String(j.roleType || "Full-Time").toLowerCase().includes(rLow)) return false;
    }
    if (!isAllFilter(experienceRange)) {
      if (String(j.experienceRange || "2-3").toLowerCase() !== String(experienceRange).toLowerCase()) return false;
    }
    if (!isAllFilter(workMode)) {
      if (!String(j.workMode || "").toLowerCase().includes(String(workMode).toLowerCase())) return false;
    }
    if (!isAllFilter(location)) {
      const locQuery = String(location).toLowerCase();
      const jLoc = `${j.location || ""} ${j.workMode || ""}`.toLowerCase();
      if (locQuery === "bay area" || locQuery.includes("san francisco")) {
        if (!/san francisco|bay area|santa clara|sunnyvale|mountain view|palo alto|san jose|menlo park|redwood|california|\bca\b/i.test(jLoc)) {
          return false;
        }
      } else if (locQuery === "remote") {
        if (!/remote|anywhere/i.test(jLoc)) return false;
      } else if (locQuery === "new york") {
        if (!/new york|nyc|\bny\b|manhattan|brooklyn/i.test(jLoc)) return false;
      } else if (locQuery === "seattle") {
        if (!/seattle|bellevue|redmond|\bwa\b|washington/i.test(jLoc)) return false;
      } else if (locQuery === "austin") {
        if (!/austin|dallas|texas|\btx\b/i.test(jLoc)) return false;
      } else if (locQuery === "boston") {
        if (!/boston|cambridge|worcester|\bma\b|massachusetts/i.test(jLoc)) return false;
      } else if (!jLoc.includes(locQuery)) {
        return false;
      }
    }
    if (!isAllFilter(degreeLevel)) {
      const degLow = String(degreeLevel).toLowerCase();
      const jDeg = `${j.degreeLevel || ""} ${j.degreeLabel || ""}`.toLowerCase();
      if (degLow.includes("bachelor")) {
        if (!jDeg.includes("bachelor") && j.degreeLevel === "PhD") return false;
      } else if (degLow.includes("master")) {
        if (!jDeg.includes("master") && j.degreeLevel !== "Master's") return false;
      } else if (degLow.includes("phd")) {
        if (!jDeg.includes("phd")) return false;
      } else if (!jDeg.includes(degLow)) {
        return false;
      }
    }
    if (query && String(query).trim()) {
      const q = String(query).trim().toLowerCase();
      const hay = `${j.company || ""} ${j.title || ""} ${j.location || ""} ${j.ats || ""} ${j.category || ""} ${j.roleType || ""} ${j.experienceLabel || ""} ${j.degreeLabel || ""} ${(j.visaTags || []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const scored = filtered.map((j) => {
    const evalRes = evaluateJobMatch(
      { title: j.title, location: j.location, description: `${j.title} ${j.company} ${j.location}` },
      profile
    );
    let affinityBoost = 0;
    if (/ai|llm|agent|eval|genai|machine learning|safety|copilot/i.test(j.title)) affinityBoost += 14;
    if (/platform|solutions|infrastructure|full[- ]?stack|python|react|software/i.test(j.title)) affinityBoost += 8;
    if (/san francisco|bay area|santa clara|mountain view|sunnyvale|palo alto|remote/i.test(j.location)) {
      affinityBoost += 6;
    }
    const finalScore = j.matchScore ? Math.max(j.matchScore, Math.min(99, evalRes.matchScore + affinityBoost)) : Math.min(99, evalRes.matchScore + affinityBoost);
    return {
      ...j,
      matchScore: finalScore
    };
  });

  scored.sort((a, b) => b.matchScore - a.matchScore || (a.postedHoursAgo || 24) - (b.postedHoursAgo || 24));
  return scored.slice(0, limit);
}

export function buildNetworkCopilotPathways(company, role = "AI Engineer") {
  const compClean = (company || "Company").trim();
  const encComp = encodeURIComponent(`"${compClean}"`);
  const encRole = encodeURIComponent(role);

  return [
    {
      label: `Clark University Alumni at ${compClean}`,
      badge: "Warmest Alumni Path",
      description: "Find fellow Clark University M.S./CS grads working at this company.",
      url: `https://www.linkedin.com/search/results/people/?keywords=${encComp}%20%22Clark%20University%22`
    },
    {
      label: `Ex-GlobalLogic / Google AI Peers at ${compClean}`,
      badge: "Shared Work Overlap",
      description: "Engineers with shared Google / GlobalLogic background now at target company.",
      url: `https://www.linkedin.com/search/results/people/?keywords=${encComp}%20(%22GlobalLogic%22%20OR%20%22Google%22)%20AI`
    },
    {
      label: `AI / Platform Engineering Managers at ${compClean}`,
      badge: "Hiring Manager Direct",
      description: "Engineering Managers & Leads on AI, LLM, and Platform teams.",
      url: `https://www.linkedin.com/search/results/people/?keywords=${encComp}%20%22Engineering%20Manager%22%20(AI%20OR%20Platform%20OR%20Machine%20Learning)`
    },
    {
      label: `Technical Recruiters at ${compClean}`,
      badge: "Recruiter Fast-Track",
      description: "Technical & AI/ML Recruiters hiring for engineering roles.",
      url: `https://www.linkedin.com/search/results/people/?keywords=${encComp}%20%22Technical%20Recruiter%22`
    },
    {
      label: `Team Engineers (${role})`,
      badge: "Peer Referral",
      description: "Individual contributors in similar roles who receive referral bonuses.",
      url: `https://www.linkedin.com/search/results/people/?keywords=${encComp}%20${encRole}`
    }
  ];
}
