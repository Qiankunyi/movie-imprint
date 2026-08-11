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
      minCards: 1,
      minEmotions: 0,
      minDistinctCardEvidence: 1,
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
      minEmotions: 0,
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
      minCards: 0,
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
      minCards: 1,
      minEmotions: 0,
      minDistinctCardEvidence: 1,
      evidenceRules: [{
        triggers: ["导演可能想表现疲惫", "这只是我的理解"],
        fields: { voice: "user", claim_mode: "interpretation" },
        requireMatch: false
      }],
      evidenceCoverage: [{ triggers: ["继续做喜欢的事"] }]
    }
  },
  {
    id: "S08_cross_source_cluster",
    title: "合成电影：凌晨回声",
    rawText: "#凌晨回声\n刚看完时我只觉得节奏有点散，没有特别想夸它。",
    interviewAnswers: [
      { questionId: "first_recall", text: "最先浮现的是女主在凌晨空车站把伞递给陌生人的画面。" },
      { questionId: "strongest_feeling", text: "我后来意识到自己其实被那种没有说出口的善意感动了。" },
      { questionId: "one_line_memory", text: "它不够完整，但那把伞让我愿意记住它。" }
    ],
    expect: {
      attitudes: ["mixed", "like"],
      minCards: 1,
      minEmotions: 1,
      evidenceCoverage: [
        { triggers: ["节奏有点散", "不够完整"] },
        { triggers: ["空车站", "那把伞", "善意感动"] }
      ]
    }
  },
  {
    id: "S09_long_reflection",
    title: "合成电影：潮汐档案",
    rawText: `#潮汐档案
开场的海边长镜头让我先安静下来。镜头没有急着解释人物，只让潮水一遍遍漫过废弃的码头。我喜欢这种克制，因为它让我有时间观察父女两个人始终错开的视线。
中段的叙事并不完全顺畅。回忆和现实之间有两次转换让我短暂迷失，我甚至觉得那封信出现得太方便了。不过，女儿在厨房里把碎掉的杯子一片片收起来时，我还是被击中了。她没有哭，也没有说原谅，只是把最后一块碎片放在掌心看了很久。
我最在意的是电影没有把和解拍成一句漂亮的话。父亲最后仍然不知道该怎么解释过去，女儿也没有突然理解一切。他们只是一起走到旧码头，在风里站了一会儿。这个停顿让我想到，有些关系能继续，并不等于伤害已经被抹掉。
声音设计也留了下来。大部分时候只有潮声、冰箱的低鸣和衣料摩擦，片尾音乐真正进入时反而显得很轻。我不确定自己是否喜欢整个故事的安排，但我确定会记得厨房里的碎杯子、码头上的停顿，以及最后没有被说出口的道歉。
散场后我想到的是自己和家人说话时那些习惯性的躲闪。电影没有给我答案，却让我想在下一次沉默之前先开口。这种联想不是因为它讲了什么大道理，而是那些动作和声音把我带回了自己的经验。`,
    expect: {
      attitudes: ["like", "mixed"],
      minCards: 3,
      minEmotions: 1,
      minDistinctCardEvidence: 3,
      evidenceCoverage: [
        { triggers: ["碎掉的杯子", "最后一块碎片"] },
        { triggers: ["码头上的停顿", "没有被说出口的道歉"] },
        { triggers: ["下一次沉默之前先开口"] }
      ]
    }
  },
  {
    id: "S10_free_reflection_independent_memories",
    title: "合成电影：逆风的夏日",
    rawText: `#逆风的夏日
河堤上的晚风和不断响起的自行车铃，是我看完最先想起的声音。那段追逐没有对白，却让我重新感觉到少年时相信时间还很多的轻盈。

便利店门口的自动贩卖机一直泛着蓝光。女主角独自站在那里，没有买任何东西，只把硬币握在手心。这个很小的动作让我想起自己每次想给家里打电话却又放下手机的犹豫。

还有一个完全不同的片段：妹妹把拍坏的合照贴回墙上，歪掉的透明胶始终没有扶正。我当时突然很难过，因为修补并不等于事情恢复原样。这个细节比结局本身留得更久。`,
    interviewAnswers: [
      { questionId: "first_recall", text: "最先浮现的还是河堤晚风和自行车铃，那段追逐有一种少年感。" },
      { questionId: "lingering_thought", text: "它让我想到小时候总觉得时间还很多，所以现在回想起来有一点怀念。" }
    ],
    expect: {
      attitudes: ["like", "love", "mixed", null],
      minCards: 3,
      minEmotions: 1,
      minDistinctCardEvidence: 3,
      requiredEvidenceSources: ["free_reflection", "self_interview"],
      minCrossSourceCards: 1,
      evidenceCoverage: [
        { sourceType: "free_reflection", triggers: ["自动贩卖机一直泛着蓝光", "硬币握在手心"] },
        { sourceType: "free_reflection", triggers: ["拍坏的合照贴回墙上", "歪掉的透明胶"] },
        { triggers: ["河堤上的晚风", "河堤晚风", "自行车铃"] }
      ]
    }
  },
  {
    id: "S11_dense_fragmented_reflection",
    title: "合成电影：回声重逢",
    rawText: `- 重看母亲离开的段落，第一次只觉得安排生硬，这次却只是心疼那个独自留下的孩子。
- 主角决定给犯错的人一次重新选择的机会，我很认同，因为谁都会希望自己能有改过的机会。
- 旧版英雄曾经失去最重要的同伴，想到这里还是很心疼。
- 他看着年轻的两个人亲密说笑，像是意识到自己已经没有时间过普通生活，让我很伤感。
- 后来他没有用绳索，而是亲手接住从高处落下的人，我看到这里直接泪目。
- 好朋友听完“朋友后来变成敌人”的故事，马上保证自己永远不会走那条路，这段很好笑。
- 但我真正留下的是这个朋友一直陪在主角身边的安慰感。
- 结尾他们再次做出只有彼此明白的手势，我真的很感动。
- 三个来自不同时代的人终于像兄弟一样互相倾诉，其中一个说“我爱你们”，这也是我的感受。
- 三个人最后拥抱告别，我也希望以后还能再见到他们。
- 看到这些亲密关系时，我也想到自己很想有人认真对我说一次爱我。
- 主角发现朋友和爱人在没有自己的生活里过得很好，于是选择不再相认，自己承担被遗忘的结果。
- 这个选择让我觉得他真的很善良，也让我对这个版本的主角更感同身受。
- 有两处特效明显不如旧版，还有角色镜头像是直接复用了过去的素材，这一点很可惜。
- 中间还有很多短笑话和普通动作，我当时笑了，但没有特别想长期记住。`,
    expect: {
      attitudes: ["like", "love", "mixed"],
      minCards: 7,
      maxCards: 10,
      minEmotions: 2,
      minDistinctCardEvidence: 7,
      evidenceCoverage: [
        { triggers: ["重新选择的机会", "改过的机会"] },
        { triggers: ["第一次只觉得安排生硬", "这次却只是心疼"] },
        { triggers: ["旧版英雄曾经失去", "亲手接住"] },
        { triggers: ["陪在主角身边的安慰感", "彼此明白的手势"] },
        { triggers: ["我爱你们", "拥抱告别"] },
        { triggers: ["很想有人认真对我说一次爱我"] },
        { triggers: ["选择不再相认", "自己承担被遗忘"] }
      ],
      sameCardEvidenceGroups: [
        { groups: [["旧版英雄曾经失去"], ["亲手接住"]] },
        { groups: [["陪在主角身边的安慰感"], ["彼此明白的手势"]] },
        { groups: [["我爱你们"], ["拥抱告别"]] }
      ],
      separateCardEvidenceGroups: [
        { groups: [["第一次只觉得安排生硬"], ["选择不再相认"]] },
        { groups: [["很想有人认真对我说一次爱我"], ["选择不再相认"]] }
      ]
    }
  }
];
