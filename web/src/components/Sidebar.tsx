'use client';

import { useState } from 'react';

import type { Conversation, Project } from '@/lib/types';

interface Props {
  projects: Project[];
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (projectId: string | null) => void;
  onDelete: (id: string) => void;
  onCreateProject: (name: string, workspacePath: string) => Promise<Project>;
}

export function Sidebar({
  projects,
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onCreateProject,
}: Props) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submitProject(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const created = await onCreateProject(name, path);
      setProjectId(created.id);
      setAdding(false);
      setName('');
      setPath('');
    } catch (caught) {
      // The gateway explains exactly why a path was refused; repeat that
      // rather than inventing a vaguer message.
      setError((caught as Error).message);
    }
  }

  return (
    <aside className="sidebar">
      <div className="section">
        <div className="section-head">
          <span>Project</span>
          <button className="btn btn-ghost btn-tiny" onClick={() => setAdding((open) => !open)}>
            {adding ? 'Huỷ' : '+ Thêm'}
          </button>
        </div>

        {adding && (
          <form onSubmit={submitProject} style={{ marginBottom: 10 }}>
            {error && <div className="error">{error}</div>}
            <div className="field">
              <label htmlFor="project-name">Tên</label>
              <input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="project-path">Đường dẫn tuyệt đối</label>
              <input
                id="project-path"
                value={path}
                placeholder="E:/work/my-repo"
                onChange={(event) => setPath(event.target.value)}
                required
              />
            </div>
            <button className="btn btn-primary btn-tiny" type="submit">
              Tạo project
            </button>
          </form>
        )}

        <div className="list">
          <button
            className="row"
            aria-current={projectId === null}
            onClick={() => setProjectId(null)}
          >
            <span className="row-title">Workspace riêng</span>
            <span className="row-sub">thư mục cá nhân của bạn</span>
          </button>

          {projects.map((project) => (
            <button
              key={project.id}
              className="row"
              aria-current={projectId === project.id}
              onClick={() => setProjectId(project.id)}
            >
              <span className="row-title">{project.name}</span>
              <span className="row-sub">{project.workspacePath}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="section" style={{ flex: 1, minHeight: 0 }}>
        <div className="section-head">
          <span>Hội thoại</span>
          <button className="btn btn-ghost btn-tiny" onClick={() => onCreate(projectId)}>
            + Mới
          </button>
        </div>

        {conversations.length === 0 ? (
          <p className="empty">Chưa có hội thoại nào.</p>
        ) : (
          <div className="list">
            {conversations.map((conversation) => (
              <div key={conversation.id} style={{ position: 'relative' }}>
                <button
                  className="row"
                  aria-current={conversation.id === activeId}
                  onClick={() => onSelect(conversation.id)}
                  style={{ paddingRight: 30 }}
                >
                  <span className="row-title">
                    {conversation.status === 'running' && '● '}
                    {conversation.title || 'Hội thoại mới'}
                  </span>
                  <span className="row-sub">{shortPath(conversation.workspacePath)}</span>
                </button>
                <button
                  className="btn btn-ghost btn-tiny"
                  title="Xoá hội thoại và thread Codex"
                  onClick={() => onDelete(conversation.id)}
                  style={{ position: 'absolute', right: 4, top: 6 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Full paths are long and all share a prefix; the tail is what differs. */
function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`;
}
