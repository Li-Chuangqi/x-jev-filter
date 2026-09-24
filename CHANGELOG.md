# 更新日志 / Changelog

## v0.4.1 · 2026-09-24

新增独立、默认关闭的 Jev 密钥加密同步。新设备输入一次同步口令后可恢复密钥；口令不保存、不上传，本机保留不可导出的解锁凭据。清除密钥会同时关闭本设备密钥同步，防止自动恢复。扩展 ID 保持不变。

Adds separate, opt-in encrypted Jev key sync. New devices unlock once with a passphrase; the passphrase is never stored or uploaded, while a non-exportable device credential persists locally. Clearing the key disables local key sync to prevent restoration. Extension ID is unchanged.

## v0.4.0 · 2026-09-24

新增默认关闭的 Chrome 个人规则同步，支持离线修改、规则删除标记、冲突备份及容量错误提示。来源样本、API 密钥和其他本机设置不上传。固定解压安装的扩展 ID；旧版升级前必须先导出规则。

Adds opt-in personal Chrome rule sync, offline edits, deletion markers, conflict backups and quota feedback. Source samples, API keys and other local settings remain on-device. Introduces a stable unpacked extension ID; export old rules before upgrading.

## v0.3.8 · 2026-09-24

修复移除菜单后屏蔽按钮的悬停显示样式失效，恢复分享按钮左侧的入口。

Restore the block action beside Share by fixing the hover visibility CSS broken during menu removal.

## v0.3.7 · 2026-09-24

信息流屏蔽按钮直接执行“屏蔽并学习相似内容”，移除选择菜单与屏蔽账号入口。点击即折叠，后台保存规则。

The feed action now blocks and learns in one click. Removed the selection menu and account-blocking shortcut; rules save in the background.

## v0.3.6 · 2026-09-24

屏蔽并学习现在直接折叠，不再弹出编辑框或浮动通知。无可靠特征的短评论保存原帖规则与样本；撤销和失败信息留在折叠条中。

Block and learn now collapses immediately without dialogs or toasts. Generic short replies save a post-only rule and sample; undo and failure feedback stay in the collapsed bar.

## v0.3.5 · 2026-09-24

手动保存规则成功后仅关闭编辑框，不再显示额外浮动通知；防止重复提交和多个编辑窗口叠加，保存失败仍在原窗口提示。

Manual rule saves now close the editor without an extra floating notice. Duplicate submissions and stacked editors are prevented; failures remain visible in the editor.

## v0.3.4 · 2026-09-24

屏蔽并学习时，条件完整的规则直接保存，不再弹出确认；仅缺少必要条件时打开填写界面。保留撤销和设置内编辑，保存失败时明确提示。

Complete learning rules now save immediately without confirmation. Only incomplete conditions open the editor. Undo, settings editing and save-failure feedback remain available.

## v0.3.3 · 2026-09-24

精简规则预览：默认只显示名称和主要屏蔽条件，匹配范围、类型、启用状态及例外收进高级设置，保留已有条件和保存前确认。

Simplifies rule previews to a name and primary conditions. Advanced controls are collapsed while existing conditions and explicit save confirmation are preserved.

## v0.3.2 · 2026-09-24

已保存 API 密钥的输入框显示掩码圆点，保存或重新打开设置后保持已填写状态；支持替换和清除密钥，显示掩码不会作为凭据提交。

Saved API keys appear masked after saving or reopening settings. Replacement and clearing remain available; the display mask is never submitted as a credential.

## v0.3.1 · 2026-09-24

自 v0.1.5 以来新增手动屏蔽、显性可编辑规则、规则预览与导入导出、独立样本管理、可选每日 API 限额，并调整悬停按钮和设置布局。

Adds manual blocking, explicit editable rules, draft previews and import/export, separate sample management, optional daily API caps, and hover/settings layout improvements since v0.1.5.

[完整中英文说明 / Full bilingual release notes](docs/releases/v0.3.1.md)

## v0.1.5 · 2026-09-23

首次发布，支持广告类别过滤、疑似 AI 创作识别、可恢复折叠、白名单、Jev 接入和扫帚图标。

Initial release with advertising categories, optional AI-authorship assessment, reversible collapsing, an allowlist, Jev integration and the broom icon.
