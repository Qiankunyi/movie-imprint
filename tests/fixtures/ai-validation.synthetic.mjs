export const syntheticAiValidationCases = [
  {
    id: "S01_explicit_like",
    title: "合成电影：雨后的站台",
    rawText: "#雨后的站台\n我喜欢它安静的结尾。最后一束光让我很感动。",
    expect: {
      attitudes: ["like", "love"],
      minCards: 1,
      minEmotions: 1,
      evidenceCoverage: [{ triggers: ["喜欢", "感动"] }]
    }
  },
  {
    id: "S02_mixed_attitude",
    title: "合成电影：漫长停顿",
    rawText: "#漫长停顿\n我理解它想用漫长停顿表现孤独，但情感上真的接受不了。画面很美，整部看完却很难说是喜欢还是不喜欢。",
    expect: {
      attitudes: ["mixed", "dislike"],
      minCards: 2,
      minEmotions: 1,
      minDistinctCardEvidence: 2,
      evidenceCoverage: [{ triggers: ["接受不了"] }, { triggers: ["画面很美"] }]
    }
  },
  {
    id: "S03_quoted_other",
    title: "合成电影：寒冷的房间",
    rawText: "#寒冷的房间\n朋友说“结尾代表希望”，但我没有这种感觉。我只觉得最后的房间很冷。",
    expect: {
      attitudes: ["neutral", "mixed", null],
      minCards: 1,
      minEmotions: 1,
      evidenceRules: [{
        triggers: ["结尾代表希望"],
        fields: { voice: "quoted_other", claim_mode: "reported_statement" },
        requireMatch: false
      }]
    }
  },
  {
    id: "S04_no_overall_attitude",
    title: "合成电影：红色雨伞",
    rawText: "#红色雨伞\n第二幕出现红色雨伞，片尾字幕用了手写字体。",
    expect: {
      attitudes: [null],
      minCards: 1,
      minEmotions: 0,
      maxCards: 2
    }
  },
  {
    id: "S05_numbered_memory_points",
    title: "合成电影：三次回声",
    rawText: "#三次回声\n1. 开场的鼓点让我紧张。\n2. 姐妹在车站告别时我很难过。\n3. 最后那句玩笑又让我笑了。",
    expect: {
      attitudes: ["like", "mixed", null],
      minCards: 3,
      minEmotions: 2,
      minDistinctCardEvidence: 3,
      evidenceCoverage: [
        { triggers: ["鼓点"] },
        { triggers: ["车站告别"] },
        { triggers: ["玩笑"] }
      ]
    }
  },
  {
    id: "S06_love_with_regret",
    title: "合成电影：没有寄出的信",
    rawText: "#没有寄出的信\n今年最喜欢的一部，散场后还想记很久。只是最后十分钟太仓促，这个遗憾也很明显。",
    expect: {
      attitudes: ["love", "like"],
      minCards: 2,
      minEmotions: 1,
      minDistinctCardEvidence: 2,
      evidenceCoverage: [{ triggers: ["最喜欢"] }, { triggers: ["太仓促", "遗憾"] }]
    }
  },
  {
    id: "S07_interpretation_not_fact",
    title: "合成电影：未完成的夏天",
    rawText: "#未完成的夏天\n我猜导演可能想表现疲惫，但这只是我的理解。我自己对正片几乎无感，却想到了要继续做喜欢的事。",
    expect: {
      attitudes: ["neutral", "mixed"],
      minCards: 2,
      minEmotions: 0,
      minDistinctCardEvidence: 2,
      evidenceRules: [{
        triggers: ["导演可能想表现疲惫", "这只是我的理解"],
        fields: { voice: "user", claim_mode: "interpretation" },
        requireMatch: true
      }],
      evidenceCoverage: [{ triggers: ["继续做喜欢的事"] }]
    }
  }
];

