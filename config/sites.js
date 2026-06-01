const sites = [
  {
    id: "cairn-main",
    name: "Cairn University Main Site",
    url: "https://cairn.edu",
    category: "main",
    checkInterval: 60,
    expectedStatus: 200,
    timeout: 10000,
    enabled: true,
  },
  {
    id: "cairn-elearning",
    name: "Cairn eLearning",
    url: "https://elearning.cairn.edu",
    category: "academics",
    checkInterval: 60,
    expectedStatus: 200,
    timeout: 10000,
    enabled: true,
  },
  {
    id: "cairn-selfservice",
    name: "Cairn Self Service",
    url: "https://selfservice.cairn.edu",
    category: "student-services",
    checkInterval: 60,
    expectedStatus: 200,
    timeout: 10000,
    enabled: true,
  },
];

module.exports = sites;
