export type StoryDoc = {
  id: string;
  title: string;
  category: string;
  status: string;
  updated: string;
  summary: string;
  content: string;
  tags: string[];
  outlines: string[];
  relations: {
    characters: string[];
    locations: string[];
    systems: string[];
  };
};

export const initialStoryDocs: StoryDoc[] = [
  {
    id: 'world_overview',
    title: '世界背景总览',
    category: '世界观',
    status: '草稿',
    updated: '今天 15:12',
    summary: '极光大陆由七座浮空城邦组成，星核能源维持着秩序，也埋下了战争的引线。',
    content:
      '极光大陆曾经是一整块完整的陆地。星坠事件之后，大地断裂为七座浮空城邦，每座城邦都依靠星核维持重力、气候和能源。\n\n玩家出生在边境矿城“灰炉”，这里负责开采低纯度星砂。随着主角发现一枚没有登记的古代星核，城邦议会、流亡者和失落机械族都会被卷入同一条主线。\n\n第一章目标是建立玩家对世界秩序的理解：星核既是文明基础，也是冲突核心。',
    tags: ['星核', '浮空城邦', '主线'],
    outlines: ['星坠事件', '七座城邦', '灰炉矿城', '主角发现古代星核'],
    relations: {
      characters: ['艾拉', '议会监察官', '灰炉矿长'],
      locations: ['灰炉', '极光议会', '旧时代遗迹'],
      systems: ['阵营声望', '主线章节'],
    },
  },
  {
    id: 'chapter_one',
    title: '第一章剧情梗概',
    category: '主线剧情',
    status: '评审中',
    updated: '昨天 18:40',
    summary: '主角在灰炉矿区遭遇星核暴走，并第一次与流亡者阵营接触。',
    content:
      '第一章开场发生在灰炉地下矿区。一次例行采矿任务中，矿道深处出现异常极光，主角和同伴艾拉被迫进入封锁区。\n\n封锁区内的旧时代设施仍在运作，玩家需要完成探索、轻战斗和一次选择事件。章节结尾处，主角带走古代星核，也因此被议会列入观察名单。',
    tags: ['第一章', '灰炉', '艾拉'],
    outlines: ['矿区事故', '封锁区探索', '古代设施', '议会观察名单'],
    relations: {
      characters: ['主角', '艾拉', '流亡者斥候'],
      locations: ['灰炉矿区', '封锁区'],
      systems: ['教学战斗', '关键选择'],
    },
  },
  {
    id: 'faction_notes',
    title: '阵营设定草案',
    category: '阵营设定',
    status: '待补充',
    updated: '2026/09/12',
    summary: '围绕星核管制形成三类主要势力：议会、流亡者和旧机械族。',
    content:
      '极光议会掌握合法星核分配权，强调秩序和资源配给。\n\n流亡者由被城邦驱逐的人组成，认为星核属于所有幸存者。\n\n旧机械族是星坠前文明的守护系统残留，它们不把人类视为敌人，但会清除任何破坏核心协议的行为。',
    tags: ['议会', '流亡者', '旧机械族'],
    outlines: ['极光议会', '流亡者', '旧机械族', '阵营冲突来源'],
    relations: {
      characters: ['议长诺温', '流亡者首领岚', '旧机械管家'],
      locations: ['极光议会', '荒原营地', '核心塔'],
      systems: ['阵营声望', '对话分支'],
    },
  },
];
