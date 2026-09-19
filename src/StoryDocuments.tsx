import { AlignLeft, Bold, BookOpen, CalendarDays, Clock3, Eye, FileText, Italic, Link, ListTree, Map, Plus, Quote, Tag } from 'lucide-react';
import type { StoryDoc } from './story-model';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './story.css';

export function StoryDocuments({
  documents,
  activeStoryId,
  setActiveStoryId,
  updateStory,
  addStoryDoc,
  readOnly = false, busy = false, contextHeader, listActions,
}: {
  documents: StoryDoc[];
  activeStoryId: string;
  setActiveStoryId: (id: string) => void;
  updateStory: (id: string, changes: Partial<StoryDoc>) => void;
  addStoryDoc: () => void;
  readOnly?: boolean; busy?: boolean; contextHeader?: ReactNode; listActions?: ReactNode;
}) {
  const selected = documents.find((document) => document.id === activeStoryId) ?? documents[0];
  if (!selected) return <section className="enum-catalog-empty"><BookOpen size={28} /><h3>暂无故事文档</h3><p>创建这个项目的第一份故事文档。</p>{!readOnly && <button className="primary" disabled={busy} onClick={addStoryDoc}>新建故事文档</button>}{listActions}</section>;
  const characterCount = selected.content.replace(/\s/g, '').length;
  const paragraphCount = selected.content.split(/\n+/).filter(Boolean).length;

  return (
    <section className="story-workspace">
      <div className="story-list-panel">
        <div className="story-panel-head">
          <div><span className="section-kicker">STORY LIBRARY</span><h3>文档库</h3></div>
          {!readOnly && <button className="icon-button" title="新建故事文档" aria-label="新建故事文档" disabled={busy} onClick={addStoryDoc}><Plus size={16} /></button>}
        </div>
        <div className="story-filter">
          <button className="active">全部</button>
          <button>世界观</button>
          <button>剧情</button>
          <button>角色</button>
        </div>
        {listActions}
        <div className="story-doc-list">
          {documents.map((document) => (
            <button
              className={`story-doc-card ${selected.id === document.id ? 'active' : ''}`}
              key={document.id}
              aria-label={'打开故事文档：' + document.title}
              onClick={() => setActiveStoryId(document.id)}
            >
              <span className="doc-category">{document.category}</span>
              <strong>{document.title}</strong>
              <small>{document.summary}</small>
              <span className="doc-meta"><Clock3 size={12} />{document.updated}<em>{document.status}</em></span>
            </button>
          ))}
        </div>
      </div>

      <fieldset disabled={readOnly || busy} className="story-editor-panel">
        <div className="story-editor-top">
          <input
            className="story-title-input"
            aria-label="文档标题"
            maxLength={160}
            value={selected.title}
            onChange={(event) => updateStory(selected.id, { title: event.target.value })}
          />
          <div className="story-editor-actions">
            <button title="预览"><Eye size={16} /></button>
            <button title="引用"><Link size={16} /></button>
          </div>
        </div>
        <div className="story-meta-grid">
          <label><span>分类</span><select aria-label="文档分类" value={selected.category} onChange={(event) => updateStory(selected.id, { category: event.target.value })}>{!['世界观','主线剧情','角色设定','阵营设定','地点设定'].includes(selected.category) && <option>{selected.category}</option>}<option>世界观</option><option>主线剧情</option><option>角色设定</option><option>阵营设定</option><option>地点设定</option></select></label>
          <label><span>状态</span><select aria-label="文档状态" value={selected.status} onChange={(event) => updateStory(selected.id, { status: event.target.value })}>{!['草稿','待补充','评审中','定稿'].includes(selected.status) && <option>{selected.status}</option>}<option>草稿</option><option>待补充</option><option>评审中</option><option>定稿</option></select></label>
        </div>
        <label className="story-summary"><span>摘要</span><textarea aria-label="文档摘要" maxLength={2000} value={selected.summary} onChange={(event) => updateStory(selected.id, { summary: event.target.value })} /></label>
        <div className="editor-toolbar">
          <button title="正文"><AlignLeft size={15} /></button>
          <button title="加粗"><Bold size={15} /></button>
          <button title="斜体"><Italic size={15} /></button>
          <button title="引用"><Quote size={15} /></button>
          <span />
          <button title="添加标签"><Tag size={15} /></button>
        </div>
        <textarea
          className="story-body"
          aria-label="文档正文"
          maxLength={100000}
          value={selected.content}
          onChange={(event) => updateStory(selected.id, { content: event.target.value })}
        />
      </fieldset>

      <div className="story-context-panel">
        {contextHeader}
        <div className="context-card"><ListField label="文档标签" items={selected.tags} disabled={readOnly || busy} onChange={tags => updateStory(selected.id, { tags })} /></div>
        <div className="context-card">
          <div className="story-panel-head"><div><span className="section-kicker">OUTLINE</span><h3>文档大纲</h3></div><ListTree size={16} /></div>
          <ListField label="文档大纲" items={selected.outlines} disabled={readOnly || busy} onChange={outlines => updateStory(selected.id, { outlines })} />
        </div>
        <div className="context-card">
          <div className="story-panel-head"><div><span className="section-kicker">LINKED CONTENT</span><h3>关联设定</h3></div><Map size={16} /></div>
          {([['characters', '关联角色'], ['locations', '关联地点'], ['systems', '关联系统']] as const).map(([key, label]) => <ListField key={key} label={label} items={selected.relations[key]} disabled={readOnly || busy} onChange={items => updateStory(selected.id, { relations: { ...selected.relations, [key]: items } })} />)}
        </div>
        <div className="context-card compact-card">
          <div><CalendarDays size={16} /><span>最后编辑</span><strong>{selected.updated}</strong></div>
          <div><FileText size={16} /><span>正文长度</span><strong>{characterCount} 字</strong></div>
          <div><BookOpen size={16} /><span>段落数量</span><strong>{paragraphCount} 段</strong></div>
        </div>
      </div>
    </section>
  );
}

function ListField({ label, items, disabled, onChange }: { label: string; items: string[]; disabled: boolean; onChange: (items: string[]) => void }) {
  const [text, setText] = useState(items.join('\n'));
  const latest = useRef(text);
  const parse = (value: string) => value.split('\n').filter(item => item.trim());
  useEffect(() => {
    if (JSON.stringify(items) !== JSON.stringify(parse(latest.current))) { latest.current = items.join('\n'); setText(latest.current); }
  }, [items]);
  return <label className="story-list-field"><span>{label}<small>每行一项</small></span><textarea aria-label={label} rows={3} disabled={disabled} value={text}
    onChange={event => { latest.current = event.target.value; setText(event.target.value); onChange(parse(event.target.value)); }} /></label>;
}
