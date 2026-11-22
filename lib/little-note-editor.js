/* ============================================================================
   Little MY Note Editor Engine (window.LittleNoteEditor)
   Transplanted verbatim from MY 노트 V1.5.1 (js/editor.js) for MY 일정관리 V1.2.0
   ============================================================================ */
(function (global) {
    'use strict';

    let _quillRegistered = false;
    let _activeQuill = null;
    let _mountOpts = null;
    let _activeOverlayHost = null;
    let _cleanupFns = [];
    let _lastAutoConvertedList = null;
    let _lastActiveTableCellTd = null;
    let _savedSpecialCharRange = null;
    let _pendingLinkState = null;

    // Resizer & Lightbox handles for Top-Layer lifecycle + Escape priority
    let _hideResizerFn = null;
    let _hideTableMenuFn = null;
    let _hideImageMenuFn = null;
    let _closeLightboxFn = null;
    let _isLightboxOpenFn = null;
    let _hasImageSelectionFn = null;
    let _tableInsertRowBelowFn = null;
    let _tableDeleteRowFn = null;
    let _tableInsertColumnRightFn = null;
    let _tableDeleteColumnFn = null;
    let _createDefaultTableFn = null;

    const TOOLBAR_CONTAINER = [
        ['undo', 'redo'],
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike', 'strike-line', 'highlight', { 'color': [] }, { 'background': [] }],
        [{ 'list': 'check' }, { 'list': 'ordered' }, { 'list': 'bullet' }],
        [{ 'align': [] }],
        ['table', 'table-insert-row', 'table-delete-row', 'table-insert-column', 'table-delete-column'],
        ['special-char', 'blockquote', 'code-block', 'divider'],
        ['link', 'image', 'video'],
        ['clean'],
        ['markdown-help']
    ];

    const CODE_LANGUAGES = [
        { key: 'plain', label: 'Plain Text' },
        { key: 'javascript', label: 'JavaScript' },
        { key: 'typescript', label: 'TypeScript' },
        { key: 'html', label: 'HTML / XML' },
        { key: 'css', label: 'CSS' },
        { key: 'json', label: 'JSON' },
        { key: 'python', label: 'Python' },
        { key: 'java', label: 'Java' },
        { key: 'cpp', label: 'C / C++' },
        { key: 'csharp', label: 'C#' },
        { key: 'sql', label: 'SQL' },
        { key: 'bash', label: 'Bash / Shell' },
        { key: 'markdown', label: 'Markdown' },
        { key: 'yaml', label: 'YAML' },
        { key: 'rust', label: 'Rust' },
        { key: 'go', label: 'Go' },
        { key: 'php', label: 'PHP' },
        { key: 'kotlin', label: 'Kotlin' },
        { key: 'swift', label: 'Swift' }
    ];

    // ========================================================================
    // 1. Verbatim Helpers & Blots from MY 노트 V1.5.1
    // ========================================================================
    function isLocalFileOrFolderPath(val) {
        if (!val || typeof val !== 'string') return false;
        const cleaned = val.trim().replace(/^["']|["']$/g, '');
        return /^[a-zA-Z]:[\\/]/.test(cleaned) ||
            /^[a-zA-Z]:$/.test(cleaned) ||
            /^\\\\/.test(cleaned) ||
            /^%[^%]+%[\\/]/.test(cleaned) ||
            /^file:\/\//i.test(cleaned);
    }

    function normalizeLinkInput(v) {
        if (!v || typeof v !== 'string') return '';
        const cleaned = v.trim().replace(/^["']|["']$/g, '');
        if (!cleaned) return '';
        if (isLocalFileOrFolderPath(cleaned) || /^(https?:\/\/|mailto:|tel:)/i.test(cleaned)) {
            return cleaned;
        }
        return 'http://' + cleaned;
    }

    function isLineCodeBlock(line, formats) {
        return Boolean(
            (formats && formats['code-block']) ||
            (line && line.domNode && line.domNode.classList && line.domNode.classList.contains('ql-code-block'))
        );
    }

    function isLineInQuote(line, formats) {
        return Boolean(
            (formats && (formats.blockquote || formats['quote-item'])) ||
            (line && line.domNode && (
                line.domNode.tagName === 'BLOCKQUOTE' ||
                (line.domNode.classList && (line.domNode.classList.contains('ql-quote-item') || line.domNode.classList.contains('ql-quote-item-true')))
            ))
        );
    }

    function getCodeBlockPrefixKind(prefix) {
        if (!prefix) return null;
        if (prefix === '\u2610 ' || prefix === '\u2611 ') return 'check';
        if (prefix === '\u2022 ') return 'bullet';
        if (/^\d+\. $/.test(prefix)) return 'ordered';
        return null;
    }

    function toggleCodeBlockListPrefix(quillInstance, range, listType) {
        if (!quillInstance || !range) return false;
        const Quill = global.Quill;
        const rawLines = quillInstance.getLines(range.index, range.length > 0 ? range.length : 1) || [];
        const codeLines = rawLines.filter((l) => isLineCodeBlock(l, typeof l.formats === 'function' ? l.formats() : null));
        if (codeLines.length === 0) return false;

        const lineInfos = codeLines.map((l) => {
            const start = quillInstance.getIndex(l);
            const text = l.domNode ? (l.domNode.textContent || '') : '';
            const m = text.match(/^([ \t]*)(\u2610 |\u2611 |\u2022 |\d+\. )?(.*)$/);
            const indent = m ? m[1] : '';
            const prefix = (m && m[2]) ? m[2] : '';
            const kind = getCodeBlockPrefixKind(prefix);
            return { line: l, start, text, indent, prefix, kind, newPrefix: '' };
        });

        const allAlreadySame = lineInfos.every((info) => info.kind === listType);
        let nextNum = 1;
        if (!allAlreadySame && listType === 'ordered') {
            const firstLine = lineInfos[0].line;
            const prev = firstLine ? firstLine.prev : null;
            if (prev && isLineCodeBlock(prev, typeof prev.formats === 'function' ? prev.formats() : null) && prev.domNode) {
                const pm = (prev.domNode.textContent || '').match(/^([ \t]*)(\d+)\. /);
                if (pm && pm[1] === lineInfos[0].indent) {
                    nextNum = parseInt(pm[2], 10) + 1;
                }
            }
        }

        lineInfos.forEach((info) => {
            if (allAlreadySame) {
                info.newPrefix = '';
            } else if (listType === 'check') {
                info.newPrefix = '\u2610 ';
            } else if (listType === 'bullet') {
                info.newPrefix = '\u2022 ';
            } else if (listType === 'ordered') {
                info.newPrefix = `${nextNum++}. `;
            }
        });

        const Delta = Quill.import('delta');
        const delta = new Delta();
        let cursor = 0;
        lineInfos.forEach((info) => {
            const prefixStart = info.start + info.indent.length;
            if (prefixStart > cursor) delta.retain(prefixStart - cursor);
            if (info.prefix.length > 0) delta.delete(info.prefix.length);
            if (info.newPrefix.length > 0) delta.insert(info.newPrefix);
            cursor = prefixStart + info.prefix.length;
        });

        quillInstance.updateContents(delta, Quill.sources.USER);

        const first = lineInfos[0];
        if (range.length === 0) {
            const prefixEnd = first.start + first.indent.length + first.prefix.length;
            const targetPos = range.index <= prefixEnd
                ? first.start + first.indent.length + first.newPrefix.length
                : Math.max(first.start + first.indent.length, range.index + first.newPrefix.length - first.prefix.length);
            quillInstance.setSelection(targetPos, 0, Quill.sources.SILENT);
        } else {
            const firstShift = first.newPrefix.length - first.prefix.length;
            const totalShift = lineInfos.reduce((acc, it) => acc + it.newPrefix.length - it.prefix.length, 0);
            const newStart = range.index > first.start + first.indent.length
                ? Math.max(first.start + first.indent.length, range.index + firstShift)
                : range.index;
            const newEnd = Math.max(newStart, range.index + range.length + totalShift);
            quillInstance.setSelection(newStart, newEnd - newStart, Quill.sources.SILENT);
        }
        return true;
    }

    function registerQuillOnce() {
        if (_quillRegistered) return;
        const Quill = global.Quill;
        if (!Quill) throw new Error('Quill library not loaded');

        if (global.hljs && typeof global.hljs.configure === 'function') {
            global.hljs.configure({ languages: ['javascript', 'python', 'html', 'css', 'typescript', 'bash'] });
        }

        const Link = Quill.import('formats/link');
        class CustomLink extends Link {
            static create(v) {
                return super.create(normalizeLinkInput(v));
            }
            static sanitize(url) {
                if (isLocalFileOrFolderPath(url)) {
                    return normalizeLinkInput(url);
                }
                return super.sanitize(url);
            }
        }
        Quill.register(CustomLink, true);

        const BlockEmbed = Quill.import('blots/block/embed');
        class DividerBlot extends BlockEmbed {}
        DividerBlot.blotName = 'divider';
        DividerBlot.tagName = 'hr';
        Quill.register(DividerBlot);

        const BaseImage = Quill.import('formats/image');
        const IMAGE_FORMAT_ATTRIBUTES = ['alt', 'height', 'width', 'style', 'data-size'];
        class CustomImage extends BaseImage {
            static formats(domNode) {
                return IMAGE_FORMAT_ATTRIBUTES.reduce((formats, attribute) => {
                    if (domNode.hasAttribute(attribute)) {
                        formats[attribute] = domNode.getAttribute(attribute);
                    }
                    return formats;
                }, {});
            }
            format(name, value) {
                if (IMAGE_FORMAT_ATTRIBUTES.indexOf(name) > -1) {
                    if (value) {
                        this.domNode.setAttribute(name, value);
                    } else {
                        this.domNode.removeAttribute(name);
                    }
                } else {
                    super.format(name, value);
                }
            }
        }
        Quill.register(CustomImage, true);

        const Embed = Quill.import('blots/embed');
        class SoftBreakBlot extends Embed {
            length() { return 1; }
            value() { return true; }
        }
        SoftBreakBlot.blotName = 'softbreak';
        SoftBreakBlot.tagName = 'br';
        SoftBreakBlot.className = 'ql-softbreak';
        Quill.register(SoftBreakBlot, true);

        const Parchment = Quill.import('parchment');
        const StrikeLineStyle = new Parchment.ClassAttributor('strike-line', 'ql-strike-line', {
            scope: Parchment.Scope.INLINE
        });
        Quill.register(StrikeLineStyle, true);

        const QuoteItemStyle = new Parchment.ClassAttributor('quote-item', 'ql-quote-item', {
            scope: Parchment.Scope.BLOCK
        });
        QuoteItemStyle.add = function (domNode, value) {
            if (value) {
                domNode.classList.add('ql-quote-item');
                return true;
            }
            domNode.classList.remove('ql-quote-item');
            domNode.classList.remove('ql-quote-item-true');
            return true;
        };
        QuoteItemStyle.remove = function (domNode) {
            domNode.classList.remove('ql-quote-item');
            domNode.classList.remove('ql-quote-item-true');
        };
        QuoteItemStyle.value = function (domNode) {
            return (domNode.classList.contains('ql-quote-item') || domNode.classList.contains('ql-quote-item-true')) ? true : undefined;
        };
        Quill.register(QuoteItemStyle, true);

        const icons = Quill.import('ui/icons');
        icons['special-char'] = '<i class="fa-regular fa-face-smile" style="font-size: 14px; color: var(--text-muted);" title="특수문자 / 이모티콘 (Ctrl+F10)"></i>';
        icons['strike-line'] = '<i class="fa-solid fa-pen-slash" style="font-size: 14px; color: var(--text-muted);"></i>';
        icons['highlight'] = '<svg viewBox="0 0 18 18"><line class="ql-stroke" x1="5" x2="5" y1="3" y2="12"></line><line class="ql-stroke" x1="13" x2="13" y1="3" y2="12"></line><line class="ql-stroke" x1="5" x2="13" y1="7.5" y2="7.5"></line><rect class="ql-highlight-bar" x="3" y="14.5" width="12" height="2.4" rx="1.2" fill="#facc15"></rect></svg>';
        icons['divider'] = '<i class="fa-solid fa-minus" style="font-size: 14px; color: var(--text-muted);"></i>';
        icons['markdown-help'] = '<i class="fa-brands fa-markdown" style="font-size: 15px; color: var(--text-muted);" title="마크다운 문법 (MD)"></i>';

        icons['table'] = '<i class="fa-solid fa-table" style="font-size: 14px; color: var(--text-muted);" title="표 삽입 (3x3) (Ctrl+Alt+T)"></i>';
        icons['table-insert-row'] = '<svg viewBox="0 0 18 18"><title>아래에 행 추가 (Alt+↓)</title><rect class="ql-stroke" x="2" y="2" width="14" height="8.5" rx="1" stroke-width="1.2" fill="none"/><line class="ql-stroke" x1="2" y1="6.25" x2="16" y2="6.25" stroke-width="1"/><line class="ql-stroke" x1="9" y1="2" x2="9" y2="10.5" stroke-width="1"/><path class="ql-stroke" d="M9 12.5v4M7 14.5h4" stroke-width="1.5" stroke-linecap="round"/></svg>';
        icons['table-delete-row'] = '<svg viewBox="0 0 18 18"><title>현재 행 삭제 (Alt+↑)</title><rect class="ql-stroke" x="2" y="2" width="14" height="8.5" rx="1" stroke-width="1.2" fill="none"/><line class="ql-stroke" x1="2" y1="6.25" x2="16" y2="6.25" stroke-width="1"/><line class="ql-stroke" x1="9" y1="2" x2="9" y2="10.5" stroke-width="1"/><line class="ql-stroke" x1="7" y1="14.5" x2="11" y2="14.5" stroke-width="1.5" stroke-linecap="round"/></svg>';
        icons['table-insert-column'] = '<svg viewBox="0 0 18 18"><title>오른쪽에 열 추가 (Alt+→)</title><rect class="ql-stroke" x="2" y="2" width="8.5" height="14" rx="1" stroke-width="1.2" fill="none"/><line class="ql-stroke" x1="6.25" y1="2" x2="6.25" y2="16" stroke-width="1"/><line class="ql-stroke" x1="2" y1="9" x2="10.5" y2="9" stroke-width="1"/><path class="ql-stroke" d="M14.5 7v4M12.5 9h4" stroke-width="1.5" stroke-linecap="round"/></svg>';
        icons['table-delete-column'] = '<svg viewBox="0 0 18 18"><title>현재 열 삭제 (Alt+←)</title><rect class="ql-stroke" x="2" y="2" width="8.5" height="14" rx="1" stroke-width="1.2" fill="none"/><line class="ql-stroke" x1="6.25" y1="2" x2="6.25" y2="16" stroke-width="1"/><line class="ql-stroke" x1="2" y1="9" x2="10.5" y2="9" stroke-width="1"/><line class="ql-stroke" x1="12.5" y1="9" x2="16.5" y2="9" stroke-width="1.5" stroke-linecap="round"/></svg>';

        icons['undo'] = '<i class="fa-solid fa-rotate-left" style="font-size: 14px; color: var(--text-muted);"></i>';
        icons['redo'] = '<i class="fa-solid fa-rotate-right" style="font-size: 14px; color: var(--text-muted);"></i>';
        icons['code-block'] = '<i class="fa-solid fa-code" style="font-size: 14px; color: var(--text-muted);"></i>';

        if (!icons['list']) icons['list'] = {};
        icons['list']['check'] = '<i class="fa-solid fa-list-check" style="font-size: 14px; color: var(--text-muted);"></i>';

        if (!icons['align']) icons['align'] = {};
        icons['align'][''] = '<i class="fa-solid fa-align-left" style="font-size: 14px; color: var(--text-muted);"></i>';
        icons['align']['center'] = '<i class="fa-solid fa-align-center" style="font-size: 14px; color: var(--text-muted);"></i>';
        icons['align']['right'] = '<i class="fa-solid fa-align-right" style="font-size: 14px; color: var(--text-muted);"></i>';
        icons['align']['justify'] = '<i class="fa-solid fa-align-justify" style="font-size: 14px; color: var(--text-muted);"></i>';

        _quillRegistered = true;
    }

    // ========================================================================
    // 2. HTML Detection & Legacy Markdown <-> Quill HTML Converters
    // ========================================================================
    function isQuillHtml(raw) {
        if (!raw || typeof raw !== 'string') return false;
        const s = raw.trim();
        if (!s) return false;
        return /^<(?:p|h[1-6]|ol|ul|blockquote|pre|table|div|hr)\b/i.test(s) ||
            /class="[^"]*ql-(?:code-block|quote-item|strike-line|softbreak|align|indent|ui)[^"]*"/i.test(s) ||
            /<li[^>]+data-list="(?:checked|unchecked|check|bullet|ordered)"/i.test(s) ||
            /<iframe[^>]+class="[^"]*ql-video[^"]*"/i.test(s) ||
            /<\s*(?:p|div)\s*>\s*<\s*br\s*\/?>\s*<\/\s*(?:p|div)\s*>/i.test(s);
    }

    function escapeHtmlStr(str) {
        return String(str || '').replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function convertLegacyInlineToQuill(text) {
        let s = String(text || '');
        const codeTokens = [];
        s = s.replace(/`([^`]+)`/g, function (_, c) {
            const idx = codeTokens.length;
            codeTokens.push('<code>' + escapeHtmlStr(c) + '</code>');
            return '\u0002LNCODE' + idx + '\u0003';
        });

        const htmlTokens = [];
        // Preserve safe legacy inline tags if already embedded in markdown lines
        s = s.replace(/<mark>([\s\S]*?)<\/mark>/gi, function (_, inner) {
            const idx = htmlTokens.length;
            htmlTokens.push('<span style="background-color: rgb(254, 240, 138);">' + convertLegacyInlineToQuill(inner) + '</span>');
            return '\u0002LNHTML' + idx + '\u0003';
        });
        s = s.replace(/<u>([\s\S]*?)<\/u>/gi, function (_, inner) {
            const idx = htmlTokens.length;
            htmlTokens.push('<u>' + convertLegacyInlineToQuill(inner) + '</u>');
            return '\u0002LNHTML' + idx + '\u0003';
        });
        s = s.replace(/<(?:del|s)>([\s\S]*?)<\/(?:del|s)>/gi, function (_, inner) {
            const idx = htmlTokens.length;
            htmlTokens.push('<s>' + convertLegacyInlineToQuill(inner) + '</s>');
            return '\u0002LNHTML' + idx + '\u0003';
        });
        s = s.replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, function (_, inner) {
            const idx = htmlTokens.length;
            htmlTokens.push('<strong>' + convertLegacyInlineToQuill(inner) + '</strong>');
            return '\u0002LNHTML' + idx + '\u0003';
        });
        s = s.replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, function (_, inner) {
            const idx = htmlTokens.length;
            htmlTokens.push('<em>' + convertLegacyInlineToQuill(inner) + '</em>');
            return '\u0002LNHTML' + idx + '\u0003';
        });
        s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function (_, href, label) {
            const idx = htmlTokens.length;
            const cleanUrl = normalizeLinkInput(href.replace(/&amp;/g, '&'));
            htmlTokens.push('<a href="' + escapeHtmlStr(cleanUrl) + '" rel="noopener noreferrer" target="_blank">' + escapeHtmlStr(label.replace(/<[^>]+>/g, '')) + '</a>');
            return '\u0002LNHTML' + idx + '\u0003';
        });

        s = escapeHtmlStr(s);
        // Images ![alt](src)
        s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, src) {
            const cleanSrc = String(src || '').replace(/&amp;/g, '&').trim();
            if (/^(https?:\/\/|data:image\/)/i.test(cleanSrc)) {
                return '<img src="' + escapeHtmlStr(cleanSrc) + '" alt="' + escapeHtmlStr(alt) + '">';
            }
            return escapeHtmlStr('![' + alt + '](' + src + ')');
        });
        // Markdown links [label](url)
        s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
            const cleanUrl = normalizeLinkInput(url.replace(/&amp;/g, '&'));
            return '<a href="' + escapeHtmlStr(cleanUrl) + '" rel="noopener noreferrer" target="_blank">' + label + '</a>';
        });
        s = s.replace(/==([^\n]+?)==/g, '<span style="background-color: rgb(254, 240, 138);">$1</span>');
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');
        s = s.replace(/__(.+?)__/g, '<u>$1</u>');
        s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');

        s = s.replace(/\u0002LNHTML(\d+)\u0003/g, function (_, idx) { return htmlTokens[Number(idx)] || ''; });
        s = s.replace(/\u0002LNCODE(\d+)\u0003/g, function (_, idx) { return codeTokens[Number(idx)] || ''; });
        return s;
    }

    function legacyMarkdownToQuillHtml(raw) {
        if (!raw || typeof raw !== 'string' || !raw.trim()) return '';
        if (isQuillHtml(raw)) return raw;

        const normLines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const isTableSep = (s) => /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(String(s || ''));
        const splitTableRow = (line) => {
            let s = String(line || '').trim();
            if (s.startsWith('|')) s = s.slice(1);
            if (s.endsWith('|')) s = s.slice(0, -1);
            return s.split('|').map(c => c.trim());
        };
        const calcIndent = (ws) => Math.min(8, Math.floor(String(ws || '').replace(/\t/g, '    ').length / 2));

        let out = '';
        let i = 0;
        while (i < normLines.length) {
            const line = normLines[i];

            // 1. Fenced code block -> Quill 2.x .ql-code-block-container
            const fenceMatch = line.match(/^\s*```([a-zA-Z0-9_+#-]*)\s*$/);
            if (fenceMatch) {
                let lang = (fenceMatch[1] || 'plain').toLowerCase().trim();
                if (lang === 'js') lang = 'javascript';
                else if (lang === 'ts') lang = 'typescript';
                else if (lang === 'py') lang = 'python';
                const codeLines = [];
                i++;
                while (i < normLines.length && !/^\s*```\s*$/.test(normLines[i])) {
                    codeLines.push(normLines[i]);
                    i++;
                }
                if (i < normLines.length) i++;
                if (codeLines.length === 0) codeLines.push('');
                out += '<div class="ql-code-block-container" spellcheck="false">';
                codeLines.forEach(cl => {
                    out += `<div class="ql-code-block" data-language="${escapeHtmlStr(lang)}">${escapeHtmlStr(cl) || '<br>'}</div>`;
                });
                out += '</div>';
                continue;
            }

            // 2. Markdown Table -> Quill table
            if (line.includes('|') && i + 1 < normLines.length && isTableSep(normLines[i + 1])) {
                const headers = splitTableRow(line);
                const colCount = Math.max(1, headers.length);
                i += 2;
                const bodyRows = [];
                while (i < normLines.length && normLines[i].includes('|') && !/^\s*```/.test(normLines[i]) && !/^\s*>/.test(normLines[i])) {
                    bodyRows.push(splitTableRow(normLines[i]));
                    i++;
                }
                let tHtml = '<table><tbody><tr>';
                for (let c = 0; c < colCount; c++) {
                    const cellHtml = convertLegacyInlineToQuill(headers[c] || '') || '<br>';
                    tHtml += `<td data-row="row-0">${cellHtml}</td>`;
                }
                tHtml += '</tr>';
                bodyRows.forEach((row, rIdx) => {
                    tHtml += '<tr>';
                    for (let c = 0; c < colCount; c++) {
                        const cellHtml = convertLegacyInlineToQuill(row[c] || '') || '<br>';
                        tHtml += `<td data-row="row-${rIdx + 1}">${cellHtml}</td>`;
                    }
                    tHtml += '</tr>';
                });
                tHtml += '</tbody></table>';
                out += tHtml;
                continue;
            }

            // 3. Horizontal Rule
            if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
                out += '<hr>';
                i++;
                continue;
            }

            // 4. Blockquote (> ... or > - ... / > 1. ... / > [ ] ...)
            if (/^\s*>\s?(.*)$/.test(line)) {
                const quoteInner = line.replace(/^\s*>\s?/, '');
                const qChk = quoteInner.match(/^([ \t]*)(?:[-*+]\s+)?\[( |x|X)\]\s+(.*)$/);
                const qUl = quoteInner.match(/^([ \t]*)[-*+]\s+(.*)$/);
                const qOl = quoteInner.match(/^([ \t]*)\d+\.\s+(.*)$/);
                if (qChk || qUl || qOl) {
                    out += '<ol>';
                    while (i < normLines.length && /^\s*>\s?(.*)$/.test(normLines[i])) {
                        const ql = normLines[i].replace(/^\s*>\s?/, '');
                        const mC = ql.match(/^([ \t]*)(?:[-*+]\s+)?\[( |x|X)\]\s+(.*)$/);
                        const mU = !mC && ql.match(/^([ \t]*)[-*+]\s+(.*)$/);
                        const mO = !mC && !mU && ql.match(/^([ \t]*)\d+\.\s+(.*)$/);
                        if (!mC && !mU && !mO) break;
                        let listType = 'bullet', ws = '', txt = '';
                        if (mC) { listType = mC[2].toLowerCase() === 'x' ? 'checked' : 'unchecked'; ws = mC[1]; txt = mC[3]; }
                        else if (mU) { listType = 'bullet'; ws = mU[1]; txt = mU[2]; }
                        else { listType = 'ordered'; ws = mO[1]; txt = mO[2]; }
                        const ind = calcIndent(ws);
                        const indCls = ind > 0 ? ` ql-indent-${ind}` : '';
                        out += `<li data-list="${listType}" class="ql-quote-item${indCls}"><span class="ql-ui" contenteditable="false"></span>${convertLegacyInlineToQuill(txt) || '<br>'}</li>`;
                        i++;
                    }
                    out += '</ol>';
                } else {
                    out += `<blockquote>${convertLegacyInlineToQuill(quoteInner) || '<br>'}</blockquote>`;
                    i++;
                }
                continue;
            }

            // 5. Lists & Checklists (contiguous lines grouped into <ol>)
            const isChk = /^([ \t]*)(?:[-*+]\s+)?\[( |x|X)\]\s+(.*)$/.test(line);
            const isUl = /^([ \t]*)[-*+]\s+(.*)$/.test(line);
            const isOl = /^([ \t]*)\d+\.\s+(.*)$/.test(line);
            if (isChk || isUl || isOl) {
                out += '<ol>';
                while (i < normLines.length) {
                    const cur = normLines[i];
                    const mC = cur.match(/^([ \t]*)(?:[-*+]\s+)?\[( |x|X)\]\s+(.*)$/);
                    const mU = !mC && cur.match(/^([ \t]*)[-*+]\s+(.*)$/);
                    const mO = !mC && !mU && cur.match(/^([ \t]*)\d+\.\s+(.*)$/);
                    if (!mC && !mU && !mO) break;
                    let listType = 'bullet', ws = '', txt = '';
                    if (mC) { listType = mC[2].toLowerCase() === 'x' ? 'checked' : 'unchecked'; ws = mC[1]; txt = mC[3]; }
                    else if (mU) { listType = 'bullet'; ws = mU[1]; txt = mU[2]; }
                    else { listType = 'ordered'; ws = mO[1]; txt = mO[2]; }
                    const ind = calcIndent(ws);
                    const indCls = ind > 0 ? ` class="ql-indent-${ind}"` : '';
                    out += `<li data-list="${listType}"${indCls}><span class="ql-ui" contenteditable="false"></span>${convertLegacyInlineToQuill(txt) || '<br>'}</li>`;
                    i++;
                }
                out += '</ol>';
                continue;
            }

            // 6. Headings #..######
            const hMatch = line.match(/^\s*(#{1,6})\s+(.*)$/);
            if (hMatch) {
                const lvl = Math.min(6, hMatch[1].length);
                out += `<h${lvl}>${convertLegacyInlineToQuill(hMatch[2]) || '<br>'}</h${lvl}>`;
                i++;
                continue;
            }

            // 7. Plain paragraph line
            out += `<p>${convertLegacyInlineToQuill(line) || '<br>'}</p>`;
            i++;
        }

        return out || '';
    }

    function stripHtmlToPlainText(raw) {
        if (!raw || typeof raw !== 'string') return '';
        if (!/<[a-zA-Z!/]/.test(raw)) return raw;
        return raw
            .replace(/<select\b[^>]*class="[^"]*ql-ui[^"]*"[^>]*>[\s\S]*?<\/select>/gi, '')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\u200B/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // ========================================================================
    // 3. Tooltips, Context Menus, Code Block Helpers & Image Resizer/Lightbox
    // ========================================================================
    function initToolbarTooltips(toolbarRoot) {
        if (!toolbarRoot) return;
        const tooltipMap = {
            '.ql-toolbar button.ql-undo': '실행 취소 (Ctrl+Z)',
            '.ql-toolbar button.ql-redo': '다시 실행 (Ctrl+Y)',
            '.ql-toolbar .ql-header .ql-picker-label': '문단 제목 (H1~H3)',
            '.ql-toolbar button.ql-bold': '굵게 (**텍스트** 또는 Ctrl+B)',
            '.ql-toolbar button.ql-italic': '기울임 (*텍스트* 또는 Ctrl+I)',
            '.ql-toolbar button.ql-underline': '밑줄 (__텍스트__ 또는 Ctrl+U)',
            '.ql-toolbar button.ql-strike': '부분 취소선 (~~텍스트~~)',
            '.ql-toolbar button.ql-strike-line': '한 줄 전체 취소선 (클릭 토글)',
            '.ql-toolbar button.ql-highlight': '형광펜 (==텍스트==)',
            '.ql-toolbar .ql-color .ql-picker-label': '글자 색상',
            '.ql-toolbar .ql-background .ql-picker-label': '배경(형광펜) 색상',
            '.ql-toolbar button.ql-list[value="check"]': '체크리스트 ([ ] 입력)',
            '.ql-toolbar button.ql-list[value="ordered"]': '번호 매기기 (1. 입력)',
            '.ql-toolbar button.ql-list[value="bullet"]': '글머리 기호 (- 입력)',
            '.ql-toolbar .ql-align .ql-picker-label': '문단 정렬',
            '.ql-toolbar button.ql-special-char': '특수문자 및 이모티콘 (Ctrl+F10)',
            '.ql-toolbar button.ql-blockquote': '인용구 (> 입력)',
            '.ql-toolbar button.ql-code-block': '코드 블록 (``` 입력)',
            '.ql-toolbar button.ql-divider': '가로 구분선 (--- 입력)',
            '.ql-toolbar button.ql-link': '하이퍼링크 연결 (URL·파일·폴더 또는 [이름](링크))',
            '.ql-toolbar button.ql-image': '이미지 첨부 (드래그/붙여넣기)',
            '.ql-toolbar button.ql-video': '동영상 삽입 (YouTube/iframe)',
            '.ql-toolbar button.ql-table': '표 삽입 (3x3) (Ctrl+Alt+T)',
            '.ql-toolbar button.ql-table-insert-row': '아래에 행 추가 (Alt+↓)',
            '.ql-toolbar button.ql-table-delete-row': '현재 행 삭제 (Alt+↑)',
            '.ql-toolbar button.ql-table-insert-column': '오른쪽에 열 추가 (Alt+→)',
            '.ql-toolbar button.ql-table-delete-column': '현재 열 삭제 (Alt+←)',
            '.ql-toolbar button.ql-clean': '선택 영역 서식 지우기',
            '.ql-toolbar button.ql-markdown-help': '마크다운 단축키 도움말'
        };
        const scopeRoot = toolbarRoot.closest('.little-note-scope') || document;
        Object.entries(tooltipMap).forEach(([selector, text]) => {
            const el = scopeRoot.querySelector(selector);
            if (el) el.setAttribute('title', text);
        });
    }

    function openExternalTarget(rawHref, opts) {
        if (!rawHref) return false;
        const clean = String(rawHref).trim();
        if (!clean) return false;
        if (opts && typeof opts.onOpenExternal === 'function') {
            opts.onOpenExternal(clean);
            return true;
        }
        if (global.chrome && global.chrome.webview && typeof global.chrome.webview.postMessage === 'function') {
            global.chrome.webview.postMessage(JSON.stringify({ type: 'openExternal', url: clean }));
            return true;
        }
        if (/^(https?:\/\/|mailto:|tel:)/i.test(clean)) {
            global.open(clean, '_blank', 'noopener,noreferrer');
            return true;
        }
        return false;
    }

    function setupTableEngine(quill, overlayHost, opts) {
        const Quill = global.Quill;
        function toastMsg(m) {
            if (opts && typeof opts.onToast === 'function') opts.onToast(m);
        }

        function updateLastActiveTableCell() {
            if (!_activeQuill) return;
            const sel = global.getSelection();
            if (sel && sel.anchorNode) {
                const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
                if (node && quill.root.contains(node)) {
                    const td = node.closest('td, th');
                    _lastActiveTableCellTd = td || null;
                    return;
                }
            }
            const range = quill.getSelection();
            if (range) {
                try {
                    const [line] = quill.getLine(range.index);
                    const td = line && line.domNode && line.domNode.closest ? line.domNode.closest('td, th') : null;
                    _lastActiveTableCellTd = td || null;
                } catch (e) {}
            }
        }

        function isCursorInTable() {
            const tableModule = quill.getModule('table');
            const range = quill.getSelection();
            if (tableModule && range) {
                try {
                    const [table] = tableModule.getTable(range);
                    if (table) return true;
                } catch (e) {}
            }
            const sel = global.getSelection();
            if (sel && sel.anchorNode) {
                const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
                if (node && quill.root.contains(node) && node.closest('table')) return true;
            }
            if (_lastActiveTableCellTd && _lastActiveTableCellTd.isConnected && quill.root.contains(_lastActiveTableCellTd)) {
                return true;
            }
            return false;
        }

        function getValidTableContext() {
            const tableModule = quill.getModule('table');
            if (!tableModule) return null;

            let range = quill.getSelection();
            if (!range) {
                const sel = global.getSelection();
                if (sel && sel.anchorNode) {
                    const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
                    const td = el && el.closest ? el.closest('td, th') : null;
                    if (td && quill.root.contains(td)) {
                        const blot = Quill.find(td);
                        if (blot) {
                            const idx = blot.offset(quill.scroll);
                            range = { index: idx, length: 0 };
                            quill.setSelection(idx, 0, Quill.sources.SILENT);
                        }
                    }
                }
            }
            if (!range && _lastActiveTableCellTd && _lastActiveTableCellTd.isConnected && quill.root.contains(_lastActiveTableCellTd)) {
                const blot = Quill.find(_lastActiveTableCellTd);
                if (blot) {
                    const idx = blot.offset(quill.scroll);
                    range = { index: idx, length: 0 };
                    quill.setSelection(idx, 0, Quill.sources.SILENT);
                }
            }
            if (!range) {
                quill.focus();
                range = quill.getSelection();
            }
            if (!range) return null;

            try {
                const [table, row, cell] = tableModule.getTable(range);
                if (table && row && cell) {
                    if (cell.domNode) _lastActiveTableCellTd = cell.domNode;
                    return { tableModule, table, row, cell, range };
                }
            } catch (e) {}
            return null;
        }

        function tableInsertRowBelowSafe(moveToFirstCell) {
            const ctx = getValidTableContext();
            if (!ctx) return;
            const { table, row, cell } = ctx;
            const rows = table.rows();
            const rowIndex = rows.indexOf(row);
            const colIndex = moveToFirstCell ? 0 : Math.max(0, row.children.indexOf(cell));

            table.insertRow(rowIndex + 1);
            quill.update(Quill.sources.USER);

            try {
                const updatedRows = table.rows();
                const newRow = updatedRows[rowIndex + 1];
                if (newRow && newRow.children) {
                    const targetCell = newRow.children.at(colIndex) || newRow.children.head;
                    if (targetCell) {
                        const targetOffset = targetCell.offset(quill.scroll);
                        quill.setSelection(targetOffset, 0, Quill.sources.USER);
                        quill.focus();
                        if (targetCell.domNode) _lastActiveTableCellTd = targetCell.domNode;
                    }
                }
            } catch (e) {}
        }

        function tableDeleteRowSafe() {
            const ctx = getValidTableContext();
            if (!ctx) return;
            const { tableModule, table, row, cell } = ctx;
            const rows = table.rows();

            const isOneByOne = (rows.length === 1 && row.children.length === 1);
            if (isOneByOne) {
                tableModule.deleteTable();
                _lastActiveTableCellTd = null;
                quill.focus();
                return;
            }
            if (rows.length <= 1) return;

            const rowIndex = rows.indexOf(row);
            const colIndex = Math.max(0, row.children.indexOf(cell));
            const survivingRowIndex = Math.min(rowIndex, rows.length - 2);

            row.remove();
            quill.update(Quill.sources.USER);

            try {
                const survivingRows = table.rows();
                const targetRow = survivingRows[survivingRowIndex];
                if (targetRow && targetRow.children) {
                    const targetCell = targetRow.children.at(colIndex) || targetRow.children.head;
                    if (targetCell) {
                        const targetOffset = targetCell.offset(quill.scroll);
                        quill.setSelection(targetOffset, 0, Quill.sources.USER);
                        quill.focus();
                        if (targetCell.domNode) _lastActiveTableCellTd = targetCell.domNode;
                    }
                }
            } catch (e) {}
        }

        function tableInsertColumnRightSafe() {
            const ctx = getValidTableContext();
            if (!ctx) return;
            const { table, row, cell } = ctx;
            const rows = table.rows();
            const rowIndex = Math.max(0, rows.indexOf(row));
            const colIndex = Math.max(0, row.children.indexOf(cell));

            table.insertColumn(colIndex + 1);
            quill.update(Quill.sources.USER);

            try {
                const updatedRows = table.rows();
                const curRow = updatedRows[rowIndex] || updatedRows[0];
                if (curRow && curRow.children) {
                    const targetCell = curRow.children.at(colIndex + 1) || curRow.children.at(colIndex) || curRow.children.head;
                    if (targetCell) {
                        const targetOffset = targetCell.offset(quill.scroll);
                        quill.setSelection(targetOffset, 0, Quill.sources.USER);
                        quill.focus();
                        if (targetCell.domNode) _lastActiveTableCellTd = targetCell.domNode;
                    }
                }
            } catch (e) {}
        }

        function tableDeleteColumnSafe() {
            const ctx = getValidTableContext();
            if (!ctx) return;
            const { tableModule, table, row, cell } = ctx;
            const rows = table.rows();

            const isOneByOne = (rows.length === 1 && row.children.length === 1);
            if (isOneByOne) {
                tableModule.deleteTable();
                _lastActiveTableCellTd = null;
                quill.focus();
                return;
            }
            if (row.children.length <= 1) return;

            const rowIndex = Math.max(0, rows.indexOf(row));
            const colIndex = Math.max(0, row.children.indexOf(cell));
            const beforeCols = row.children.length;
            const survivingColIndex = Math.min(colIndex, beforeCols - 2);

            table.deleteColumn(colIndex);
            quill.update(Quill.sources.USER);

            try {
                const survivingRows = table.rows();
                const curRow = survivingRows[rowIndex] || survivingRows[0];
                if (curRow && curRow.children) {
                    const targetCell = curRow.children.at(survivingColIndex) || curRow.children.head;
                    if (targetCell) {
                        const targetOffset = targetCell.offset(quill.scroll);
                        quill.setSelection(targetOffset, 0, Quill.sources.USER);
                        quill.focus();
                        if (targetCell.domNode) _lastActiveTableCellTd = targetCell.domNode;
                    }
                }
            } catch (e) {}
        }

        function createDefaultTable() {
            const tableModule = quill.getModule('table');
            if (!tableModule) return;
            let range = quill.getSelection();
            if (!range) {
                quill.focus();
                range = quill.getSelection();
                if (!range) {
                    const len = quill.getLength();
                    quill.setSelection(Math.max(0, len - 1), 0);
                }
            }
            tableModule.insertTable(3, 3);
            setTimeout(() => {
                quill.focus();
                updateLastActiveTableCell();
            }, 10);
        }

        _tableInsertRowBelowFn = tableInsertRowBelowSafe;
        _tableDeleteRowFn = tableDeleteRowSafe;
        _tableInsertColumnRightFn = tableInsertColumnRightSafe;
        _tableDeleteColumnFn = tableDeleteColumnSafe;
        _createDefaultTableFn = createDefaultTable;

        const onSelChange = () => updateLastActiveTableCell();
        const onMouseDownCell = () => setTimeout(updateLastActiveTableCell, 0);
        const onKeyUpCell = () => updateLastActiveTableCell();
        document.addEventListener('selectionchange', onSelChange);
        quill.root.addEventListener('mousedown', onMouseDownCell);
        quill.root.addEventListener('keyup', onKeyUpCell);
        _cleanupFns.push(() => {
            document.removeEventListener('selectionchange', onSelChange);
            quill.root.removeEventListener('mousedown', onMouseDownCell);
            quill.root.removeEventListener('keyup', onKeyUpCell);
        });

        // Build #table-context-menu inside overlayHost (dialog#editor Top Layer!)
        let tableContextMenu = overlayHost.querySelector('#table-context-menu');
        if (tableContextMenu) tableContextMenu.remove();
        tableContextMenu = document.createElement('div');
        tableContextMenu.id = 'table-context-menu';
        tableContextMenu.className = 'table-context-menu';
        tableContextMenu.style.display = 'none';
        tableContextMenu.innerHTML = `
            <div class="table-menu-item" data-action="insert-softbreak"><i class="fa-solid fa-turn-down"></i><span>셀 내부 줄바꿈 (Shift+Enter)</span></div>
            <div class="table-menu-divider"></div>
            <div class="table-menu-item" data-action="insert-row-above"><i class="fa-solid fa-arrow-up"></i><span>위에 행 추가</span></div>
            <div class="table-menu-item" data-action="insert-row-below"><i class="fa-solid fa-arrow-down"></i><span>아래에 행 추가</span></div>
            <div class="table-menu-item" data-action="insert-col-left"><i class="fa-solid fa-arrow-left"></i><span>왼쪽에 열 추가</span></div>
            <div class="table-menu-item" data-action="insert-col-right"><i class="fa-solid fa-arrow-right"></i><span>오른쪽에 열 추가</span></div>
            <div class="table-menu-divider"></div>
            <div class="table-menu-item text-danger" data-action="delete-row"><i class="fa-solid fa-minus"></i><span>현재 행 삭제</span></div>
            <div class="table-menu-item text-danger" data-action="delete-col"><i class="fa-solid fa-minus"></i><span>현재 열 삭제</span></div>
            <div class="table-menu-divider"></div>
            <div class="table-menu-item text-danger" data-action="delete-table"><i class="fa-regular fa-trash-can"></i><span>표 전체 삭제</span></div>
        `;
        overlayHost.appendChild(tableContextMenu);

        _hideTableMenuFn = () => {
            tableContextMenu.style.display = 'none';
        };

        function showTableContextMenu(cell, clientX, clientY) {
            if (_hideImageMenuFn) _hideImageMenuFn();
            const curSel = quill.getSelection();
            let isInsideCell = false;
            if (curSel) {
                const [line] = quill.getLine(curSel.index);
                isInsideCell = (line && line.domNode && line.domNode.closest && line.domNode.closest('td, th') === cell);
            }
            if (!isInsideCell) {
                const blot = Quill.find(cell);
                if (blot && typeof blot.offset === 'function') {
                    quill.setSelection(blot.offset(quill.scroll), 0, Quill.sources.USER);
                }
            }
            _lastActiveTableCellTd = cell;

            tableContextMenu.style.visibility = 'hidden';
            tableContextMenu.style.display = 'block';
            const menuWidth = tableContextMenu.offsetWidth || 195;
            const menuHeight = tableContextMenu.offsetHeight || 310;
            tableContextMenu.style.visibility = '';

            let x = clientX;
            let y = clientY;
            if (x + menuWidth > global.innerWidth) x = global.innerWidth - menuWidth - 10;
            if (y + menuHeight > global.innerHeight) y = global.innerHeight - menuHeight - 10;

            tableContextMenu.style.left = `${Math.max(10, x)}px`;
            tableContextMenu.style.top = `${Math.max(10, y)}px`;
        }

        const onContextMenu = (e) => {
            if (e.target.closest('img')) return;
            const cell = e.target.closest('td, th');
            if (!cell || !quill.root.contains(cell)) {
                tableContextMenu.style.display = 'none';
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            showTableContextMenu(cell, e.clientX, e.clientY);
        };

        let touchTimer = null;
        let touchStartX = 0;
        let touchStartY = 0;
        const onTouchStart = (e) => {
            if (e.target.closest('img')) return;
            const cell = e.target.closest('td, th');
            if (!cell || !quill.root.contains(cell) || e.touches.length > 1) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(40);
                showTableContextMenu(cell, touchStartX, touchStartY);
            }, 450);
        };
        const onTouchMove = (e) => {
            if (touchTimer && e.touches.length > 0) {
                if (Math.abs(e.touches[0].clientX - touchStartX) > 10 || Math.abs(e.touches[0].clientY - touchStartY) > 10) {
                    clearTimeout(touchTimer);
                    touchTimer = null;
                }
            }
        };
        const onTouchEnd = () => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }
        };
        const onDocClick = (e) => {
            if (!e.target.closest('#table-context-menu')) {
                tableContextMenu.style.display = 'none';
            }
        };

        quill.root.addEventListener('contextmenu', onContextMenu);
        quill.root.addEventListener('touchstart', onTouchStart, { passive: true });
        quill.root.addEventListener('touchmove', onTouchMove, { passive: true });
        quill.root.addEventListener('touchend', onTouchEnd, { passive: true });
        document.addEventListener('click', onDocClick);

        tableContextMenu.querySelectorAll('.table-menu-item').forEach((item) => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                tableContextMenu.style.display = 'none';
                const tableModule = quill.getModule('table');
                if (!tableModule) return;
                quill.focus();
                switch (action) {
                    case 'insert-softbreak': {
                        const sel = quill.getSelection(true) || quill.getSelection();
                        if (sel) {
                            quill.insertEmbed(sel.index, 'softbreak', true, Quill.sources.USER);
                            quill.setSelection(sel.index + 1, 0, Quill.sources.USER);
                        }
                        break;
                    }
                    case 'insert-row-above': tableModule.insertRowAbove(); break;
                    case 'insert-row-below': tableInsertRowBelowSafe(); break;
                    case 'insert-col-left': tableModule.insertColumnLeft(); break;
                    case 'insert-col-right': tableInsertColumnRightSafe(); break;
                    case 'delete-row': tableDeleteRowSafe(); break;
                    case 'delete-col': tableDeleteColumnSafe(); break;
                    case 'delete-table':
                        if (global.confirm('현재 표를 전체 삭제하시겠습니까?')) {
                            tableModule.deleteTable();
                            _lastActiveTableCellTd = null;
                        }
                        break;
                }
            });
        });

        // Global table & special-char keyboard shortcuts (Ctrl+Alt+T, Alt+Arrows)
        const onTableShortcutKey = (e) => {
            if (!_activeQuill) return;
            if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 't' || e.key === 'T' || e.code === 'KeyT')) {
                e.preventDefault();
                e.stopPropagation();
                createDefaultTable();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'F10' || e.keyCode === 121)) {
                e.preventDefault();
                e.stopPropagation();
                _savedSpecialCharRange = quill.getSelection();
                if (opts && typeof opts.onOpenSpecialChar === 'function') opts.onOpenSpecialChar();
                return;
            }
            if (e.altKey && !e.shiftKey) {
                const isDown = e.key === 'ArrowDown' || e.key === 'Down' || e.code === 'ArrowDown' || e.code === 'Numpad2' || e.keyCode === 40;
                const isUp = e.key === 'ArrowUp' || e.key === 'Up' || e.code === 'ArrowUp' || e.code === 'Numpad8' || e.keyCode === 38;
                const isRight = e.key === 'ArrowRight' || e.key === 'Right' || e.code === 'ArrowRight' || e.code === 'Numpad6' || e.keyCode === 39;
                const isLeft = e.key === 'ArrowLeft' || e.key === 'Left' || e.code === 'ArrowLeft' || e.code === 'Numpad4' || e.keyCode === 37;
                if ((isDown || isUp || isRight || isLeft) && isCursorInTable()) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isDown) tableInsertRowBelowSafe();
                    else if (isUp) tableDeleteRowSafe();
                    else if (isRight) tableInsertColumnRightSafe();
                    else if (isLeft) tableDeleteColumnSafe();
                }
            }
        };
        global.addEventListener('keydown', onTableShortcutKey, true);

        _cleanupFns.push(() => {
            quill.root.removeEventListener('contextmenu', onContextMenu);
            quill.root.removeEventListener('touchstart', onTouchStart);
            quill.root.removeEventListener('touchmove', onTouchMove);
            quill.root.removeEventListener('touchend', onTouchEnd);
            document.removeEventListener('click', onDocClick);
            global.removeEventListener('keydown', onTableShortcutKey, true);
            tableContextMenu.remove();
            _hideTableMenuFn = null;
        });

        return { toastMsg, isCursorInTable, tableInsertRowBelowSafe };
    }

    function setupImageResizerLightboxAndMenu(quill, editorContainerEl, overlayHost, opts) {
        const Quill = global.Quill;
        function toastMsg(m) {
            if (opts && typeof opts.onToast === 'function') opts.onToast(m);
        }

        let activeResizingImg = null;
        const selectedImages = new Set();
        let isDraggingResize = false;
        let dragDir = 'se';
        let dragStartX = 0;
        let dragStartWidth = 0;
        let dragEditorMaxWidth = 0;
        let dragCurrentPct = 100;
        let rafId = null;

        let resizerEl = overlayHost.querySelector('#zen-image-resizer');
        if (resizerEl) resizerEl.remove();
        resizerEl = document.createElement('div');
        resizerEl.id = 'zen-image-resizer';
        resizerEl.innerHTML = `
            <div class="zen-img-toolbar" id="zen-img-toolbar">
                <button type="button" class="zen-img-tb-btn" data-size="25%" title="너비 25%">25%</button>
                <button type="button" class="zen-img-tb-btn" data-size="50%" title="너비 50%">50%</button>
                <button type="button" class="zen-img-tb-btn" data-size="75%" title="너비 75%">75%</button>
                <button type="button" class="zen-img-tb-btn" data-size="100%" title="최대 너비 (100%)">100%</button>
                <div class="zen-img-tb-divider"></div>
                <button type="button" class="zen-img-tb-btn" data-action="copy" title="이미지 복사 (Ctrl+C)">
                    <i class="fa-regular fa-copy"></i>
                    <span>Copy</span>
                </button>
                <button type="button" class="zen-img-tb-btn" data-action="cut" title="이미지 잘라내기 (Ctrl+X)">
                    <i class="fa-solid fa-scissors"></i>
                    <span>Cut</span>
                </button>
                <div class="zen-img-tb-divider"></div>
                <button type="button" class="zen-img-tb-btn" data-action="zoom" title="원본 크게 확대 보기 (더블클릭)">
                    <i class="fa-solid fa-magnifying-glass-plus"></i>
                    <span>확대</span>
                </button>
                <button type="button" class="zen-img-tb-btn danger" data-action="delete" title="이미지 삭제 (Delete / Backspace)">
                    <i class="fa-regular fa-trash-can"></i>
                </button>
            </div>
            <div class="zen-resize-badge" id="zen-resize-badge">100%</div>
            <div class="zen-resize-handle nw" data-dir="nw"></div>
            <div class="zen-resize-handle ne" data-dir="ne"></div>
            <div class="zen-resize-handle sw" data-dir="sw"></div>
            <div class="zen-resize-handle se" data-dir="se"></div>
        `;
        overlayHost.appendChild(resizerEl);

        const toolbarEl = resizerEl.querySelector('#zen-img-toolbar');
        const badgeEl = resizerEl.querySelector('#zen-resize-badge');

        let lightboxEl = overlayHost.querySelector('#zen-image-lightbox');
        if (lightboxEl) lightboxEl.remove();
        lightboxEl = document.createElement('div');
        lightboxEl.id = 'zen-image-lightbox';
        lightboxEl.innerHTML = `
            <button type="button" class="zen-lightbox-top-close" id="zen-lb-top-close" title="닫기 (ESC)">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <div class="zen-lightbox-stage" id="zen-lightbox-stage">
                <img id="zen-lightbox-img" src="" alt="확대 이미지" draggable="false" />
            </div>
            <div class="zen-lightbox-controls">
                <button type="button" class="zen-lb-btn" id="zen-lb-zoom-out" title="축소 (-)">
                    <i class="fa-solid fa-minus"></i>
                </button>
                <button type="button" class="zen-lb-btn zen-lb-zoom-label" id="zen-lb-zoom-reset" title="100% 원본 비율로 초기화">100%</button>
                <button type="button" class="zen-lb-btn" id="zen-lb-zoom-in" title="확대 (+)">
                    <i class="fa-solid fa-plus"></i>
                </button>
                <div class="zen-img-tb-divider"></div>
                <button type="button" class="zen-lb-btn" id="zen-lb-close-btn" title="닫기 (ESC)">
                    <i class="fa-solid fa-xmark"></i>
                    <span>닫기</span>
                </button>
            </div>
        `;
        overlayHost.appendChild(lightboxEl);

        const lbControls = lightboxEl.querySelector('.zen-lightbox-controls');
        if (lbControls) lbControls.addEventListener('click', (e) => e.stopPropagation());
        const lbStage = lightboxEl.querySelector('#zen-lightbox-stage');
        const lbImg = lightboxEl.querySelector('#zen-lightbox-img');
        const lbZoomLabel = lightboxEl.querySelector('#zen-lb-zoom-reset');

        let imgMenu = overlayHost.querySelector('#image-context-menu');
        if (imgMenu) imgMenu.remove();
        imgMenu = document.createElement('div');
        imgMenu.id = 'image-context-menu';
        imgMenu.className = 'table-context-menu image-context-menu';
        imgMenu.style.display = 'none';
        imgMenu.innerHTML = `
            <div class="table-menu-item" data-action="zoom-view"><i class="fa-solid fa-magnifying-glass-plus"></i><span>크게 확대 보기</span></div>
            <div class="table-menu-divider"></div>
            <div class="table-menu-item" data-action="copy"><i class="fa-regular fa-copy"></i><span>복사</span><span class="menu-shortcut-hint">Ctrl+C</span></div>
            <div class="table-menu-item" data-action="cut"><i class="fa-solid fa-scissors"></i><span>잘라내기</span><span class="menu-shortcut-hint">Ctrl+X</span></div>
            <div class="table-menu-item" data-action="save-as"><i class="fa-solid fa-download"></i><span>이미지 저장 (다른 이름으로)</span></div>
            <div class="table-menu-divider"></div>
            <div class="image-menu-size-row">
                <button type="button" class="image-menu-size-btn" data-size="25%">25%</button>
                <button type="button" class="image-menu-size-btn" data-size="50%">50%</button>
                <button type="button" class="image-menu-size-btn" data-size="75%">75%</button>
                <button type="button" class="image-menu-size-btn" data-size="100%">100%</button>
            </div>
            <div class="table-menu-item" data-action="replace-image"><i class="fa-regular fa-images"></i><span>이미지 교체</span></div>
            <div class="table-menu-divider"></div>
            <div class="table-menu-item text-danger" data-action="delete"><i class="fa-regular fa-trash-can"></i><span>삭제</span><span class="menu-shortcut-hint">Delete</span></div>
            <input type="file" id="image-replace-input" accept="image/*" style="display:none;" />
        `;
        overlayHost.appendChild(imgMenu);
        const replaceInput = imgMenu.querySelector('#image-replace-input');

        function getEditorAvailableWidth() {
            if (!quill || !quill.root) return 600;
            const style = global.getComputedStyle(quill.root);
            const padLeft = parseFloat(style.paddingLeft) || 0;
            const padRight = parseFloat(style.paddingRight) || 0;
            const unzoomedAvail = Math.max(120, quill.root.clientWidth - padLeft - padRight);
            const rootRect = quill.root.getBoundingClientRect();
            const zoomFactor = (quill.root.offsetWidth > 0 && rootRect.width > 0) ? (rootRect.width / quill.root.offsetWidth) : 1;
            return Math.max(120, unzoomedAvail * zoomFactor);
        }

        function getCurrentImgPercent(img) {
            if (!img) return 100;
            const dataSize = img.getAttribute('data-size');
            if (dataSize && dataSize.endsWith('%')) {
                const parsed = parseInt(dataSize, 10);
                if (!isNaN(parsed)) return parsed;
            }
            const inlineWidth = img.style && img.style.width;
            if (inlineWidth && inlineWidth.endsWith('%')) {
                const parsed = parseInt(inlineWidth, 10);
                if (!isNaN(parsed)) return parsed;
            }
            const availW = getEditorAvailableWidth();
            const rectW = img.getBoundingClientRect().width;
            if (availW > 0 && rectW > 0) {
                return Math.min(100, Math.max(10, Math.round((rectW / availW) * 100)));
            }
            return 100;
        }

        function updateToolbarActiveButtons(pct) {
            const sizeStr = `${pct}%`;
            toolbarEl.querySelectorAll('.zen-img-tb-btn[data-size]').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.size === sizeStr);
            });
        }

        function syncMultiSelectedClasses() {
            if (!quill || !quill.root) return;
            Array.from(selectedImages).forEach((img) => {
                if (!img || !img.isConnected || !quill.root.contains(img)) selectedImages.delete(img);
            });
            quill.root.querySelectorAll('img.zen-img-multi-selected').forEach((img) => {
                if (selectedImages.size < 2 || !selectedImages.has(img)) {
                    img.classList.remove('zen-img-multi-selected');
                    if (img.classList.length === 0) img.removeAttribute('class');
                }
            });
            if (selectedImages.size >= 2) {
                selectedImages.forEach((img) => img.classList.add('zen-img-multi-selected'));
            }
        }

        function getSelectedImagesOrdered() {
            const imgs = [];
            if (quill && quill.root) {
                selectedImages.forEach((img) => {
                    if (img && img.isConnected && quill.root.contains(img)) imgs.push(img);
                    else selectedImages.delete(img);
                });
                if (imgs.length === 0 && activeResizingImg && activeResizingImg.isConnected && quill.root.contains(activeResizingImg)) {
                    imgs.push(activeResizingImg);
                }
            }
            imgs.sort((a, b) => {
                try {
                    const blotA = Quill.find(a);
                    const blotB = Quill.find(b);
                    if (blotA && blotB) return quill.getIndex(blotA) - quill.getIndex(blotB);
                } catch (e) {}
                const pos = a.compareDocumentPosition(b);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
                if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
                return 0;
            });
            return imgs;
        }

        function buildCleanImageHtml(img) {
            const clone = img.cloneNode(false);
            clone.classList.remove('zen-img-multi-selected');
            if (clone.classList.length === 0) clone.removeAttribute('class');
            return clone.outerHTML;
        }

        function hideZenImageResizer() {
            activeResizingImg = null;
            selectedImages.clear();
            syncMultiSelectedClasses();
            isDraggingResize = false;
            resizerEl.classList.remove('is-dragging');
            resizerEl.style.display = 'none';
        }
        _hideResizerFn = hideZenImageResizer;
        _hasImageSelectionFn = () => Boolean(activeResizingImg || selectedImages.size > 0);

        function syncZenImageResizerPosition() {
            if (selectedImages.size > 1) {
                resizerEl.style.display = 'none';
                return;
            }
            if (!activeResizingImg || !activeResizingImg.isConnected || !quill.root.contains(activeResizingImg)) {
                hideZenImageResizer();
                return;
            }
            const imgRect = activeResizingImg.getBoundingClientRect();
            const boundsEl = editorContainerEl || quill.root;
            const boundsRect = boundsEl.getBoundingClientRect();

            if (imgRect.width <= 0 || imgRect.height <= 0 || imgRect.bottom < boundsRect.top + 8 || imgRect.top > boundsRect.bottom - 8) {
                resizerEl.style.visibility = 'hidden';
                resizerEl.style.opacity = '0';
                return;
            }

            resizerEl.style.visibility = 'visible';
            resizerEl.style.opacity = '1';
            resizerEl.style.top = `${imgRect.top}px`;
            resizerEl.style.left = `${imgRect.left}px`;
            resizerEl.style.width = `${imgRect.width}px`;
            resizerEl.style.height = `${imgRect.height}px`;

            toolbarEl.classList.remove('pos-bottom', 'pos-inside-top');
            const spaceAbove = imgRect.top - boundsRect.top;
            const spaceBelow = boundsRect.bottom - imgRect.bottom;
            if (spaceAbove < 48) {
                if (spaceBelow >= 48) toolbarEl.classList.add('pos-bottom');
                else toolbarEl.classList.add('pos-inside-top');
            }

            toolbarEl.style.left = '50%';
            toolbarEl.style.transform = 'translateX(-50%)';
            const tbRect = toolbarEl.getBoundingClientRect();
            const viewportW = global.innerWidth;
            if (tbRect.left < 8) {
                toolbarEl.style.transform = `translateX(calc(-50% + ${8 - tbRect.left}px))`;
            } else if (tbRect.right > viewportW - 8) {
                toolbarEl.style.transform = `translateX(calc(-50% - ${tbRect.right - (viewportW - 8)}px))`;
            }
        }

        function requestSyncPosition() {
            if (!activeResizingImg || selectedImages.size > 1) return;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(syncZenImageResizerPosition);
        }

        function showZenImageResizer(img) {
            if (!img) return;
            selectedImages.clear();
            selectedImages.add(img);
            syncMultiSelectedClasses();

            activeResizingImg = img;
            resizerEl.style.display = 'block';
            const pct = getCurrentImgPercent(img);
            updateToolbarActiveButtons(pct);
            badgeEl.textContent = `${pct}%`;
            syncZenImageResizerPosition();
        }

        function applyImageWidthPercent(imgOrPct, maybePct) {
            let pct = maybePct;
            let explicitImg = imgOrPct;
            if (typeof imgOrPct === 'number' && maybePct === undefined) {
                pct = imgOrPct;
                explicitImg = null;
            }
            if (typeof pct !== 'number' || isNaN(pct)) return;

            const clamped = Math.max(10, Math.min(100, Math.round(pct)));
            const styleVal = `width: ${clamped}%; height: auto;`;
            const sizeVal = `${clamped}%`;

            let targets = getSelectedImagesOrdered();
            if (explicitImg && (!targets.length || (targets.length === 1 && targets[0] !== explicitImg && selectedImages.size <= 1))) {
                targets = [explicitImg];
            }
            if (!targets.length) return;

            targets.forEach((targetImg) => {
                targetImg.setAttribute('style', styleVal);
                targetImg.setAttribute('data-size', sizeVal);
                targetImg.removeAttribute('width');
                targetImg.removeAttribute('height');
                try {
                    const blot = Quill.find(targetImg);
                    if (blot && typeof blot.format === 'function') {
                        blot.format('style', styleVal);
                        blot.format('data-size', sizeVal);
                        blot.format('width', false);
                        blot.format('height', false);
                    }
                } catch (err) {}
            });

            if (targets.length === 1 && resizerEl.style.display === 'block') {
                updateToolbarActiveButtons(clamped);
                badgeEl.textContent = sizeVal;
                syncZenImageResizerPosition();
                setTimeout(syncZenImageResizerPosition, 20);
            }
        }

        function deleteActiveImage() {
            const targets = getSelectedImagesOrdered();
            if (!targets.length) return;
            const items = targets.map((img) => {
                let idx = -1;
                try {
                    const blot = Quill.find(img);
                    if (blot) idx = quill.getIndex(blot);
                } catch (e) {}
                return { img, idx };
            });
            hideZenImageResizer();

            const validItems = items.filter(it => it.idx >= 0).sort((a, b) => b.idx - a.idx);
            const invalidItems = items.filter(it => it.idx < 0);
            if (validItems.length > 0) {
                const minIdx = validItems[validItems.length - 1].idx;
                try {
                    if (quill.history && typeof quill.history.cutoff === 'function') quill.history.cutoff();
                    validItems.forEach(({ idx }) => quill.deleteText(idx, 1, Quill.sources.USER));
                    if (quill.history && typeof quill.history.cutoff === 'function') quill.history.cutoff();
                    quill.setSelection(Math.min(minIdx, Math.max(0, quill.getLength() - 1)), 0, Quill.sources.SILENT);
                } catch (e) {
                    validItems.forEach(({ img }) => { if (img && img.parentNode) img.remove(); });
                }
            }
            invalidItems.forEach(({ img }) => { if (img && img.parentNode) img.remove(); });
        }

        async function copyActiveImage(showToastMsg = true) {
            const targets = getSelectedImagesOrdered();
            if (!targets.length) return false;
            let copied = false;

            if (targets.length === 1) {
                const targetImg = targets[0];
                const src = targetImg.src;
                if (!src) return false;
                const cleanHtml = buildCleanImageHtml(targetImg);

                if (navigator.clipboard && global.isSecureContext !== false) {
                    try {
                        let blob = null;
                        if (src.startsWith('data:image/') || src.startsWith('blob:')) {
                            const res = await fetch(src);
                            blob = await res.blob();
                        } else {
                            blob = await new Promise((resolve, reject) => {
                                const tempImg = new Image();
                                tempImg.crossOrigin = 'anonymous';
                                tempImg.onload = () => {
                                    try {
                                        const cvs = document.createElement('canvas');
                                        cvs.width = tempImg.naturalWidth || tempImg.width || 300;
                                        cvs.height = tempImg.naturalHeight || tempImg.height || 150;
                                        cvs.getContext('2d').drawImage(tempImg, 0, 0);
                                        cvs.toBlob((b) => b ? resolve(b) : reject(new Error('Canvas null')), 'image/png');
                                    } catch (err) { reject(err); }
                                };
                                tempImg.onerror = reject;
                                tempImg.src = src;
                            });
                        }
                        if (blob && typeof ClipboardItem !== 'undefined') {
                            const pngBlob = blob.type === 'image/png' ? blob : new Blob([await blob.arrayBuffer()], { type: 'image/png' });
                            await navigator.clipboard.write([new ClipboardItem({
                                'image/png': pngBlob,
                                'text/html': new Blob([cleanHtml], { type: 'text/html' })
                            })]);
                            copied = true;
                        }
                    } catch (e) {}
                }
                if (!copied) {
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            await navigator.clipboard.writeText(src);
                            copied = true;
                        }
                    } catch (e) {}
                }
            } else {
                const htmlPayload = targets.map(img => `<p>${buildCleanImageHtml(img)}</p>`).join('');
                if (navigator.clipboard && global.isSecureContext !== false && typeof ClipboardItem !== 'undefined') {
                    try {
                        await navigator.clipboard.write([new ClipboardItem({
                            'text/html': new Blob([htmlPayload], { type: 'text/html' }),
                            'text/plain': new Blob([''], { type: 'text/plain' })
                        })]);
                        copied = true;
                    } catch (e) {}
                }
            }

            if (showToastMsg) toastMsg(copied ? '이미지가 복사되었습니다.' : '클립보드 복사에 실패했습니다.');
            return copied;
        }

        async function cutActiveImage() {
            const targets = getSelectedImagesOrdered();
            if (!targets.length) return;
            const success = await copyActiveImage(false);
            if (!success) {
                toastMsg('클립보드 복사에 실패하여 잘라내기를 취소했습니다.');
                return;
            }
            deleteActiveImage();
            toastMsg('이미지를 잘라냈습니다.');
        }

        // Lightbox controls
        let lbScale = 1, lbTranslateX = 0, lbTranslateY = 0;
        let isPanning = false, panStartX = 0, panStartY = 0, didMoveDuringPan = false;
        let initialPinchDist = 0, initialPinchScale = 1;

        function updateLightboxTransform() {
            lbImg.style.transform = `translate(${lbTranslateX}px, ${lbTranslateY}px) scale(${lbScale})`;
            lbZoomLabel.textContent = `${Math.round(lbScale * 100)}%`;
        }
        function setLightboxZoom(newScale, resetPan = false) {
            lbScale = Math.max(0.5, Math.min(5, Math.round(newScale * 100) / 100));
            if (resetPan || lbScale <= 1) { lbTranslateX = 0; lbTranslateY = 0; }
            updateLightboxTransform();
        }
        function openZenImageLightbox(src) {
            if (!src) return;
            lbImg.src = src;
            lbScale = 1; lbTranslateX = 0; lbTranslateY = 0;
            updateLightboxTransform();
            lightboxEl.classList.add('is-open');
        }
        function closeZenImageLightbox() {
            if (!lightboxEl.classList.contains('is-open')) return;
            lightboxEl.classList.remove('is-open');
            isPanning = false;
            lbStage.classList.remove('is-panning');
        }
        _closeLightboxFn = closeZenImageLightbox;
        _isLightboxOpenFn = () => lightboxEl.classList.contains('is-open');

        lightboxEl.querySelector('#zen-lb-zoom-in').addEventListener('click', () => setLightboxZoom(lbScale + 0.25));
        lightboxEl.querySelector('#zen-lb-zoom-out').addEventListener('click', () => setLightboxZoom(lbScale - 0.25));
        lightboxEl.querySelector('#zen-lb-zoom-reset').addEventListener('click', () => setLightboxZoom(1, true));
        lightboxEl.querySelector('#zen-lb-close-btn').addEventListener('click', closeZenImageLightbox);
        lightboxEl.querySelector('#zen-lb-top-close').addEventListener('click', closeZenImageLightbox);
        lightboxEl.addEventListener('wheel', (e) => {
            if (!lightboxEl.classList.contains('is-open')) return;
            e.preventDefault();
            setLightboxZoom(lbScale + (e.deltaY < 0 ? 0.2 : -0.2));
        }, { passive: false });
        lbImg.addEventListener('dblclick', (e) => {
            e.preventDefault(); e.stopPropagation();
            setLightboxZoom(lbScale > 1.05 ? 1 : 2, lbScale > 1.05);
        });
        lbStage.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isPanning = true; didMoveDuringPan = false;
            panStartX = e.clientX - lbTranslateX; panStartY = e.clientY - lbTranslateY;
            lbStage.classList.add('is-panning');
        });
        const onLbMouseMove = (e) => {
            if (!isPanning) return;
            const nextX = e.clientX - panStartX, nextY = e.clientY - panStartY;
            if (Math.abs(nextX - lbTranslateX) > 4 || Math.abs(nextY - lbTranslateY) > 4) didMoveDuringPan = true;
            lbTranslateX = nextX; lbTranslateY = nextY;
            updateLightboxTransform();
        };
        const onLbMouseUp = (e) => {
            if (!isPanning) return;
            isPanning = false;
            lbStage.classList.remove('is-panning');
            if (!didMoveDuringPan && e.target === lbStage) closeZenImageLightbox();
        };
        lbStage.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                isPanning = true; didMoveDuringPan = false;
                panStartX = e.touches[0].clientX - lbTranslateX; panStartY = e.touches[0].clientY - lbTranslateY;
                lbStage.classList.add('is-panning');
            } else if (e.touches.length === 2) {
                isPanning = false; didMoveDuringPan = true;
                initialPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                initialPinchScale = lbScale;
            }
        }, { passive: true });
        lbStage.addEventListener('touchmove', (e) => {
            if (!lightboxEl.classList.contains('is-open')) return;
            if (e.cancelable) e.preventDefault();
            if (e.touches.length === 1 && isPanning) {
                const nextX = e.touches[0].clientX - panStartX, nextY = e.touches[0].clientY - panStartY;
                if (Math.abs(nextX - lbTranslateX) > 4 || Math.abs(nextY - lbTranslateY) > 4) didMoveDuringPan = true;
                lbTranslateX = nextX; lbTranslateY = nextY;
                updateLightboxTransform();
            } else if (e.touches.length === 2 && initialPinchDist > 0) {
                const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                setLightboxZoom(initialPinchScale * (dist / initialPinchDist));
            }
        }, { passive: false });
        lbStage.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                isPanning = false; initialPinchDist = 0; lbStage.classList.remove('is-panning');
            }
        }, { passive: true });

        // Resizer toolbar & corner handle drag
        toolbarEl.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const btn = e.target.closest('.zen-img-tb-btn');
            if (!btn || !activeResizingImg) return;
            if (btn.dataset.size) {
                const pct = parseInt(btn.dataset.size, 10);
                if (!isNaN(pct)) applyImageWidthPercent(activeResizingImg, pct);
            } else if (btn.dataset.action === 'copy') copyActiveImage(true);
            else if (btn.dataset.action === 'cut') cutActiveImage();
            else if (btn.dataset.action === 'zoom') openZenImageLightbox(activeResizingImg.src);
            else if (btn.dataset.action === 'delete') deleteActiveImage();
        });
        ['mousedown', 'touchstart'].forEach(evt => {
            resizerEl.addEventListener(evt, (e) => e.stopPropagation(), { passive: false });
        });

        function startResizeDrag(clientX, dir, e) {
            if (!activeResizingImg) return;
            if (e && e.cancelable) e.preventDefault();
            isDraggingResize = true; dragDir = dir || 'se';
            dragStartX = clientX;
            dragStartWidth = activeResizingImg.getBoundingClientRect().width;
            dragEditorMaxWidth = getEditorAvailableWidth();
            dragCurrentPct = getCurrentImgPercent(activeResizingImg);
            resizerEl.classList.add('is-dragging');
            badgeEl.textContent = `${dragCurrentPct}% · ${Math.round(dragStartWidth)}px`;
        }
        function moveResizeDrag(clientX) {
            if (!isDraggingResize || !activeResizingImg) return;
            const dx = clientX - dragStartX;
            const deltaW = (dragDir === 'nw' || dragDir === 'sw') ? -dx : dx;
            const minPx = Math.max(48, Math.round(dragEditorMaxWidth * 0.1));
            const newWidthPx = Math.max(minPx, Math.min(dragEditorMaxWidth, dragStartWidth + deltaW));
            let pct = Math.max(10, Math.min(100, Math.round((newWidthPx / dragEditorMaxWidth) * 100)));
            for (const snap of [25, 50, 75, 100]) {
                if (Math.abs(pct - snap) <= 2) { pct = snap; break; }
            }
            dragCurrentPct = pct;
            activeResizingImg.style.width = `${pct}%`;
            activeResizingImg.style.height = 'auto';
            activeResizingImg.setAttribute('data-size', `${pct}%`);
            badgeEl.textContent = `${pct}% · ${Math.round(activeResizingImg.getBoundingClientRect().width)}px`;
            updateToolbarActiveButtons(pct);
            syncZenImageResizerPosition();
        }
        function endResizeDrag() {
            if (!isDraggingResize) return;
            isDraggingResize = false;
            resizerEl.classList.remove('is-dragging');
            if (activeResizingImg) applyImageWidthPercent(activeResizingImg, dragCurrentPct);
        }
        resizerEl.querySelectorAll('.zen-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => startResizeDrag(e.clientX, handle.dataset.dir, e));
            handle.addEventListener('touchstart', (e) => {
                if (e.touches.length === 1) startResizeDrag(e.touches[0].clientX, handle.dataset.dir, e);
            }, { passive: false });
        });
        const onWinMouseMove = (e) => { if (isDraggingResize) { e.preventDefault(); moveResizeDrag(e.clientX); } };
        const onWinTouchMove = (e) => { if (isDraggingResize && e.touches.length === 1) { if (e.cancelable) e.preventDefault(); moveResizeDrag(e.touches[0].clientX); } };

        // Image click / multi-select / dblclick
        const onImgMouseDownCapture = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.button === 0) {
                const img = e.target.closest('img');
                if (img && quill.root.contains(img)) { e.preventDefault(); e.stopPropagation(); }
            }
        };
        const onImgClick = (e) => {
            const img = e.target.closest('img');
            const isCtrl = e.ctrlKey || e.metaKey;
            if (!isCtrl) {
                const qSel = quill.getSelection();
                const domSel = global.getSelection();
                const hasDomRange = domSel && domSel.rangeCount > 0 && !domSel.isCollapsed && quill.root.contains(domSel.anchorNode);
                if ((qSel && qSel.length > 0) || hasDomRange) return;
            }
            if (img && quill.root.contains(img)) {
                e.stopPropagation();
                if (isCtrl) {
                    e.preventDefault();
                    const domSel = global.getSelection();
                    if (domSel && !domSel.isCollapsed) domSel.removeAllRanges();
                    if (activeResizingImg && activeResizingImg.isConnected && quill.root.contains(activeResizingImg) && !selectedImages.has(activeResizingImg)) {
                        selectedImages.add(activeResizingImg);
                    }
                    if (selectedImages.has(img)) selectedImages.delete(img);
                    else selectedImages.add(img);
                    if (selectedImages.size === 0) hideZenImageResizer();
                    else if (selectedImages.size === 1) showZenImageResizer(Array.from(selectedImages)[0]);
                    else {
                        activeResizingImg = img;
                        isDraggingResize = false;
                        resizerEl.classList.remove('is-dragging');
                        resizerEl.style.display = 'none';
                        syncMultiSelectedClasses();
                    }
                } else {
                    showZenImageResizer(img);
                }
            } else if (activeResizingImg || selectedImages.size > 0) {
                hideZenImageResizer();
            }
        };
        const onImgDblClick = (e) => {
            const img = e.target.closest('img');
            if (img && quill.root.contains(img) && img.src) {
                e.preventDefault(); e.stopPropagation();
                openZenImageLightbox(img.src);
            }
        };
        const onDocOutsideMouseDown = (e) => {
            if (!activeResizingImg && selectedImages.size === 0) return;
            const clickedImg = e.target.closest ? e.target.closest('img') : null;
            if ((clickedImg && (clickedImg === activeResizingImg || selectedImages.has(clickedImg))) ||
                ((e.ctrlKey || e.metaKey) && clickedImg && quill.root.contains(clickedImg)) ||
                e.target.closest('#zen-image-resizer') ||
                e.target.closest('#zen-image-lightbox') ||
                e.target.closest('#image-context-menu')) return;
            hideZenImageResizer();
        };
        const onImgKeyDown = (e) => {
            if (!activeResizingImg && selectedImages.size === 0) return;
            if (lightboxEl.classList.contains('is-open')) return;
            const qSel = quill.getSelection();
            const domSel = global.getSelection();
            if ((qSel && qSel.length > 0) || (domSel && domSel.rangeCount > 0 && !domSel.isCollapsed && quill.root.contains(domSel.anchorNode))) return;

            const isCtrl = e.ctrlKey || e.metaKey;
            const keyLower = e.key ? e.key.toLowerCase() : '';
            if (isCtrl && keyLower === 'c') { e.preventDefault(); e.stopPropagation(); copyActiveImage(true); return; }
            if (isCtrl && keyLower === 'x') { e.preventDefault(); e.stopPropagation(); cutActiveImage(); return; }
            if (isCtrl && keyLower === 'z' && !e.shiftKey) {
                e.preventDefault(); e.stopPropagation(); hideZenImageResizer();
                try { quill.history.undo(); } catch (err) {}
                return;
            }
            if (isCtrl && (keyLower === 'y' || (keyLower === 'z' && e.shiftKey))) {
                e.preventDefault(); e.stopPropagation(); hideZenImageResizer();
                try { quill.history.redo(); } catch (err) {}
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); deleteActiveImage(); }
            else if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                const targetImg = activeResizingImg;
                hideZenImageResizer();
                try {
                    const blot = Quill.find(targetImg);
                    if (blot) { quill.focus(); quill.setSelection(quill.getIndex(blot) + 1, 0, Quill.sources.USER); }
                } catch (err) {}
            }
        };

        // Image Context Menu
        let contextTargetImg = null;
        function hideImageContextMenu() { imgMenu.style.display = 'none'; }
        _hideImageMenuFn = hideImageContextMenu;

        function showImageContextMenu(imgEl, clientX, clientY) {
            if (!imgEl) return;
            contextTargetImg = imgEl;
            if (_hideTableMenuFn) _hideTableMenuFn();
            const keepMulti = selectedImages.size > 1 && selectedImages.has(imgEl);
            if (!keepMulti) showZenImageResizer(imgEl);

            let curW = (imgEl.style.width || '').trim();
            if (keepMulti) {
                const multiImgs = Array.from(quill.root.querySelectorAll('img.zen-img-multi-selected'));
                const widths = new Set(multiImgs.map(el => (el.style.width || '').trim()));
                curW = widths.size === 1 ? Array.from(widths)[0] : '';
            }
            imgMenu.querySelectorAll('.image-menu-size-btn').forEach(btn => {
                btn.classList.toggle('active', curW === btn.dataset.size);
            });

            imgMenu.style.visibility = 'hidden';
            imgMenu.style.display = 'block';
            const mw = imgMenu.offsetWidth || 215, mh = imgMenu.offsetHeight || 280;
            imgMenu.style.visibility = '';
            let x = clientX, y = clientY;
            if (x + mw > global.innerWidth) x = global.innerWidth - mw - 10;
            if (y + mh > global.innerHeight) y = global.innerHeight - mh - 10;
            imgMenu.style.left = `${Math.max(10, x)}px`;
            imgMenu.style.top = `${Math.max(10, y)}px`;
        }

        const onImgContextMenu = (e) => {
            const img = e.target.closest('img');
            if (!img || !quill.root.contains(img)) { hideImageContextMenu(); return; }
            e.preventDefault(); e.stopPropagation();
            showImageContextMenu(img, e.clientX, e.clientY);
        };
        let imgTouchTimer = null, imgTouchX = 0, imgTouchY = 0;
        const onImgTouchStart = (e) => {
            const img = e.target.closest('img');
            if (!img || !quill.root.contains(img) || e.touches.length > 1) return;
            imgTouchX = e.touches[0].clientX; imgTouchY = e.touches[0].clientY;
            imgTouchTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(40);
                showImageContextMenu(img, imgTouchX, imgTouchY);
            }, 450);
        };
        const onImgTouchMove = (e) => {
            if (imgTouchTimer && e.touches.length > 0 && (Math.abs(e.touches[0].clientX - imgTouchX) > 10 || Math.abs(e.touches[0].clientY - imgTouchY) > 10)) {
                clearTimeout(imgTouchTimer); imgTouchTimer = null;
            }
        };
        const onImgTouchEnd = () => { if (imgTouchTimer) { clearTimeout(imgTouchTimer); imgTouchTimer = null; } };
        const onDocClickImgMenu = (e) => { if (!e.target.closest('#image-context-menu')) hideImageContextMenu(); };

        imgMenu.querySelectorAll('.image-menu-size-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pct = parseInt(btn.dataset.size, 10);
                hideImageContextMenu();
                const keepMulti = selectedImages.size > 1 && contextTargetImg && selectedImages.has(contextTargetImg);
                if (!keepMulti && contextTargetImg) showZenImageResizer(contextTargetImg);
                if (!isNaN(pct)) applyImageWidthPercent(pct);
            });
        });
        imgMenu.querySelectorAll('.table-menu-item').forEach(item => {
            item.addEventListener('click', async () => {
                const action = item.dataset.action;
                const targetImg = contextTargetImg;
                hideImageContextMenu();
                if (!targetImg) return;
                const keepMulti = selectedImages.size > 1 && selectedImages.has(targetImg);
                if (!keepMulti) showZenImageResizer(targetImg);

                if (action === 'zoom-view') openZenImageLightbox(targetImg.src);
                else if (action === 'copy') await copyActiveImage(true);
                else if (action === 'cut') await cutActiveImage();
                else if (action === 'save-as') {
                    try {
                        const res = await fetch(targetImg.src);
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `일정_이미지_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.png`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (err) { toastMsg('이미지 저장에 실패했습니다.'); }
                } else if (action === 'replace-image' && replaceInput) {
                    replaceInput.value = '';
                    replaceInput.click();
                } else if (action === 'delete') deleteActiveImage();
            });
        });
        if (replaceInput) {
            replaceInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file || !contextTargetImg) return;
                const reader = new FileReader();
                reader.onload = () => {
                    const newSrc = reader.result;
                    if (typeof newSrc !== 'string') return;
                    const keepWidth = contextTargetImg.style.width || '';
                    const blot = Quill.find(contextTargetImg);
                    if (blot) {
                        const idx = quill.getIndex(blot);
                        quill.deleteText(idx, 1, Quill.sources.USER);
                        quill.insertEmbed(idx, 'image', newSrc, Quill.sources.USER);
                        if (keepWidth) quill.formatText(idx, 1, 'style', `width: ${keepWidth}; height: auto;`, Quill.sources.USER);
                        const [newLeaf] = quill.getLeaf(idx);
                        if (newLeaf && newLeaf.domNode && newLeaf.domNode.tagName === 'IMG') {
                            setTimeout(() => showZenImageResizer(newLeaf.domNode), 30);
                        }
                    } else {
                        contextTargetImg.src = newSrc;
                    }
                    toastMsg('이미지가 교체되었습니다.');
                };
                reader.readAsDataURL(file);
            });
        }

        const onTextChangeImgSync = () => {
            if (selectedImages.size > 0) {
                let changed = false;
                Array.from(selectedImages).forEach((img) => {
                    if (!img.isConnected || !quill.root.contains(img)) { selectedImages.delete(img); changed = true; }
                });
                if (changed) {
                    if (selectedImages.size === 0) { hideZenImageResizer(); return; }
                    if (selectedImages.size === 1) { showZenImageResizer(Array.from(selectedImages)[0]); return; }
                    syncMultiSelectedClasses();
                }
            }
            syncMultiSelectedClasses();
            if (activeResizingImg) {
                if (!activeResizingImg.isConnected || !quill.root.contains(activeResizingImg)) {
                    if (selectedImages.size > 1) activeResizingImg = Array.from(selectedImages)[0];
                    else hideZenImageResizer();
                } else if (selectedImages.size <= 1) requestSyncPosition();
            }
        };
        quill.on('text-change', onTextChangeImgSync);

        global.addEventListener('mousemove', onLbMouseMove);
        global.addEventListener('mouseup', onLbMouseUp);
        global.addEventListener('mousemove', onWinMouseMove, { passive: false });
        global.addEventListener('touchmove', onWinTouchMove, { passive: false });
        global.addEventListener('mouseup', endResizeDrag);
        global.addEventListener('touchend', endResizeDrag);
        global.addEventListener('keydown', onImgKeyDown, true);
        global.addEventListener('resize', requestSyncPosition, { passive: true });
        quill.root.addEventListener('scroll', requestSyncPosition, { passive: true });
        quill.root.addEventListener('mousedown', onImgMouseDownCapture, true);
        quill.root.addEventListener('click', onImgClick);
        quill.root.addEventListener('dblclick', onImgDblClick);
        quill.root.addEventListener('contextmenu', onImgContextMenu);
        quill.root.addEventListener('touchstart', onImgTouchStart, { passive: true });
        quill.root.addEventListener('touchmove', onImgTouchMove, { passive: true });
        quill.root.addEventListener('touchend', onImgTouchEnd, { passive: true });
        document.addEventListener('mousedown', onDocOutsideMouseDown);
        document.addEventListener('click', onDocClickImgMenu);

        _cleanupFns.push(() => {
            if (rafId) cancelAnimationFrame(rafId);
            global.removeEventListener('mousemove', onLbMouseMove);
            global.removeEventListener('mouseup', onLbMouseUp);
            global.removeEventListener('mousemove', onWinMouseMove);
            global.removeEventListener('touchmove', onWinTouchMove);
            global.removeEventListener('mouseup', endResizeDrag);
            global.removeEventListener('touchend', endResizeDrag);
            global.removeEventListener('keydown', onImgKeyDown, true);
            global.removeEventListener('resize', requestSyncPosition);
            quill.root.removeEventListener('scroll', requestSyncPosition);
            quill.root.removeEventListener('mousedown', onImgMouseDownCapture, true);
            quill.root.removeEventListener('click', onImgClick);
            quill.root.removeEventListener('dblclick', onImgDblClick);
            quill.root.removeEventListener('contextmenu', onImgContextMenu);
            quill.root.removeEventListener('touchstart', onImgTouchStart);
            quill.root.removeEventListener('touchmove', onImgTouchMove);
            quill.root.removeEventListener('touchend', onImgTouchEnd);
            document.removeEventListener('mousedown', onDocOutsideMouseDown);
            document.removeEventListener('click', onDocClickImgMenu);
            resizerEl.remove();
            lightboxEl.remove();
            imgMenu.remove();
            _hideResizerFn = null;
            _hideImageMenuFn = null;
            _closeLightboxFn = null;
            _isLightboxOpenFn = null;
            _hasImageSelectionFn = null;
        });
    }

    function setupCodeBlockInteractions(quill, overlayHost, opts) {
        const Quill = global.Quill;
        function toastMsg(m) {
            if (opts && typeof opts.onToast === 'function') opts.onToast(m);
        }

        let tooltipEl = overlayHost.querySelector('#zen-codeblock-tooltip');
        if (tooltipEl) tooltipEl.remove();
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'zen-codeblock-tooltip';
        tooltipEl.className = 'zen-codeblock-tooltip';
        overlayHost.appendChild(tooltipEl);

        let currentKey = '';
        function hideTooltip() {
            currentKey = '';
            tooltipEl.classList.remove('is-visible');
        }
        function showTooltipAtRect(text, rect, key) {
            if (!text || !rect) { hideTooltip(); return; }
            if (currentKey !== key || tooltipEl.textContent !== text) {
                tooltipEl.textContent = text;
                currentKey = key;
            }
            tooltipEl.classList.add('is-visible');
            const tipW = tooltipEl.offsetWidth || 104, tipH = tooltipEl.offsetHeight || 28;
            const left = Math.max(8, Math.min(Math.max(8, (global.innerWidth || 1024) - tipW - 8), rect.left + (rect.width - tipW) / 2));
            let top = rect.top - tipH - 7;
            if (top < 8) top = rect.bottom + 7;
            tooltipEl.style.left = `${Math.round(left)}px`;
            tooltipEl.style.top = `${Math.round(top)}px`;
        }

        const onPointerMove = (e) => {
            if (e.pointerType === 'touch') return;
            const container = e.target && e.target.closest ? e.target.closest('.ql-code-block-container') : null;
            if (!container) { if (currentKey) hideTooltip(); return; }
            const selectEl = e.target && e.target.closest ? e.target.closest('select.ql-ui') : null;
            if (selectEl) {
                if (selectEl.hasAttribute('title')) selectEl.removeAttribute('title');
                if (document.activeElement === selectEl) { hideTooltip(); return; }
                showTooltipAtRect('코드 언어 선택', selectEl.getBoundingClientRect(), 'lang');
                return;
            }
            const rect = container.getBoundingClientRect();
            const clickX = e.clientX - rect.left, clickY = e.clientY - rect.top;
            if (clickX >= rect.width - 44 && clickX <= rect.width && clickY >= 0 && clickY <= 40) {
                showTooltipAtRect('코드 전체 복사', { left: rect.right - 40, right: rect.right - 14, top: rect.top + 8, bottom: rect.top + 32, width: 26, height: 24 }, 'copy');
                return;
            }
            if (currentKey) hideTooltip();
        };

        const onEditorClick = (e) => {
            const container = e.target.closest('.ql-code-block-container');
            if (!container) return;
            const rect = container.getBoundingClientRect();
            if ((e.clientX - rect.left) > rect.width - 40 && (e.clientY - rect.top) < 40) {
                e.preventDefault(); e.stopPropagation();
                const codeText = Array.from(container.querySelectorAll('.ql-code-block')).map(l => l.textContent).join('\n');
                navigator.clipboard.writeText(codeText).then(() => {
                    container.classList.add('is-copied');
                    toastMsg('코드블록이 클립보드에 복사되었습니다.');
                    setTimeout(() => container.classList.remove('is-copied'), 2000);
                }).catch(() => toastMsg('복사에 실패했습니다.'));
                return;
            }
            if (e.target.closest('select.ql-ui') || e.shiftKey || e.ctrlKey || e.metaKey) return;
            const domSel = global.getSelection();
            if (domSel && !domSel.isCollapsed) return;
            const codeLineEl = e.target.closest('.ql-code-block');
            if (!codeLineEl) return;
            const rawLineText = codeLineEl.textContent || '';
            const cbMatch = rawLineText.match(/^([ \t]*)([\u2610\u2611])(?=\s|$)/);
            if (!cbMatch) return;
            let caretNode = null, caretOffset = 0;
            if (typeof document.caretRangeFromPoint === 'function') {
                const cr = document.caretRangeFromPoint(e.clientX, e.clientY);
                if (cr) { caretNode = cr.startContainer; caretOffset = cr.startOffset; }
            }
            if (!caretNode || !codeLineEl.contains(caretNode)) return;
            let charOffset = 0;
            try {
                const preRange = document.createRange();
                preRange.selectNodeContents(codeLineEl);
                preRange.setEnd(caretNode, caretOffset);
                charOffset = preRange.toString().length;
            } catch { return; }
            const checkboxRelIdx = cbMatch[1].length;
            if (charOffset < checkboxRelIdx || charOffset > checkboxRelIdx + 1) return;
            const blot = Quill.find(codeLineEl);
            if (!blot) return;
            e.preventDefault();
            const absIdx = quill.getIndex(blot) + checkboxRelIdx;
            const nextChar = cbMatch[2] === '\u2610' ? '\u2611' : '\u2610';
            const Delta = Quill.import('delta');
            const delta = new Delta();
            if (absIdx > 0) delta.retain(absIdx);
            delta.delete(1).insert(nextChar);
            quill.updateContents(delta, Quill.sources.USER);
            quill.setSelection(absIdx + 1, 0, Quill.sources.SILENT);
        };

        const onSelectChange = (e) => {
            if (!e.target || !e.target.matches('.ql-code-block-container select.ql-ui')) return;
            const scrollEditor = quill.root.scrollTop;
            const restore = () => {
                quill.blur();
                if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
                quill.root.scrollTop = scrollEditor;
            };
            restore();
            setTimeout(restore, 0);
            setTimeout(restore, 50);
        };

        quill.root.addEventListener('pointermove', onPointerMove);
        quill.root.addEventListener('mouseleave', hideTooltip);
        quill.root.addEventListener('pointerdown', hideTooltip, true);
        quill.root.addEventListener('click', onEditorClick);
        quill.root.addEventListener('change', onSelectChange, true);
        quill.root.addEventListener('scroll', hideTooltip, { passive: true });
        _cleanupFns.push(() => {
            quill.root.removeEventListener('pointermove', onPointerMove);
            quill.root.removeEventListener('mouseleave', hideTooltip);
            quill.root.removeEventListener('pointerdown', hideTooltip, true);
            quill.root.removeEventListener('click', onEditorClick);
            quill.root.removeEventListener('change', onSelectChange, true);
            quill.root.removeEventListener('scroll', hideTooltip);
            tooltipEl.remove();
        });
    }

    // ========================================================================
    // 4. Markdown Help Modal (MY 노트 V1.5.1 verbatim, clean Zen styling)
    // ========================================================================
    function openMarkdownHelpModal() {
        const modal = document.getElementById('markdownHelpModal');
        if (!modal) return;
        modal.innerHTML = `
            <div class="md-help-header">
                <div class="md-help-title-wrap">
                    <span class="md-help-title">
                        <i class="fa-brands fa-markdown" style="color: var(--accent); font-size: 18px;"></i> 마크다운 단축키 안내
                    </span>
                    <div class="md-help-subtitle">입력 후 <b>Space</b>를 누르면 서식이 즉시 적용됩니다.</div>
                </div>
                <button type="button" id="closeMdHelpTopBtn" title="닫기 (Esc)" style="background:transparent; border:none; font-size:18px; color:var(--text-muted); cursor:pointer; padding:2px 6px;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="md-help-body">
                <table class="md-help-table">
                    <thead>
                        <tr>
                            <th style="width: 14%;">툴바</th>
                            <th style="width: 54%;">키보드 입력</th>
                            <th style="width: 32%;">변환 결과</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td><span class="md-tb-badge">H1</span></td><td><code class="md-key"># </code></td><td><span style="font-weight: 700;">대제목 (H1)</span></td></tr>
                        <tr><td><span class="md-tb-badge">H2</span></td><td><code class="md-key">## </code></td><td><span style="font-weight: 700;">중제목 (H2)</span></td></tr>
                        <tr><td><span class="md-tb-badge">H3</span></td><td><code class="md-key">### </code></td><td><span style="font-weight: 600;">소제목 (H3)</span></td></tr>
                        <tr><td><span class="md-tb-badge" style="font-weight: 800; font-size: 13px;">B</span></td><td><code class="md-key">**단어** </code></td><td><strong>굵게</strong></td></tr>
                        <tr><td><span class="md-tb-badge" style="font-style: italic; font-family: serif; font-size: 13px;">I</span></td><td><code class="md-key">*단어* </code></td><td><em>기울임꼴</em></td></tr>
                        <tr><td><span class="md-tb-badge" style="text-decoration: underline; font-size: 13px;">U</span></td><td><code class="md-key">__단어__ </code></td><td><u>밑줄</u></td></tr>
                        <tr><td><span class="md-tb-badge" style="text-decoration: line-through; font-size: 13px;">S</span></td><td><code class="md-key">~~단어~~ </code></td><td><del style="color: var(--text-muted);">취소선</del></td></tr>
                        <tr><td><span class="md-tb-badge" style="background: #fef08a; color: #854d0e; font-weight: 800; font-size: 12px; padding: 1px 4px; border-radius: 3px;">H</span></td><td><code class="md-key">==단어== </code></td><td><span style="background: #fef08a; color: #854d0e; padding: 1px 5px; border-radius: 3px; font-weight: 600;">형광펜</span></td></tr>
                        <tr><td><i class="fa-solid fa-keyboard" style="font-size: 11px; color: var(--text-muted);"></i></td><td><code class="md-key">\`단어\` </code></td><td><code style="background-color: rgba(79, 70, 229, 0.1); color: var(--accent); padding: 2px 4px; border-radius: 4px; font-size: 12px;">인라인 코드</code></td></tr>
                        <tr><td><i class="fa-solid fa-list-check" style="font-size: 12px; color: var(--text-muted);"></i></td><td><code class="md-key">[ ] </code>, <code class="md-key">- [ ] </code></td><td>체크리스트 (Tab으로 들여쓰기)</td></tr>
                        <tr><td><i class="fa-solid fa-list-ol" style="font-size: 12px; color: var(--text-muted);"></i></td><td><code class="md-key">1. </code></td><td>번호 목록 (Tab으로 단계 조절)</td></tr>
                        <tr><td><i class="fa-solid fa-list-ul" style="font-size: 12px; color: var(--text-muted);"></i></td><td><code class="md-key">- </code>, <code class="md-key">* </code>, <code class="md-key">+ </code></td><td>글머리 기호 (Tab으로 단계 조절)</td></tr>
                        <tr><td><i class="fa-solid fa-table" style="font-size: 12px; color: var(--text-muted);"></i></td><td><code class="md-key">|제목|내용| </code>, <code class="md-key">Ctrl+Alt+T</code></td><td>표 (셀 우클릭으로 행/열/표 삭제)</td></tr>
                        <tr>
                            <td><i class="fa-solid fa-table-cells-large" style="font-size: 12px; color: var(--text-muted);"></i></td>
                            <td>
                                <div class="md-key-lines">
                                    <div class="md-key-row">
                                        <span class="md-key-pair"><code class="md-key">Alt+↓</code>(행+)</span>
                                        <span class="md-key-pair"><code class="md-key">Alt+↑</code>(행-)</span>
                                    </div>
                                    <div class="md-key-row">
                                        <span class="md-key-pair"><code class="md-key">Alt+→</code>(열+)</span>
                                        <span class="md-key-pair"><code class="md-key">Alt+←</code>(열-)</span>
                                    </div>
                                </div>
                            </td>
                            <td>행/열 편집</td>
                        </tr>
                        <tr><td><i class="fa-regular fa-face-smile" style="font-size: 12px; color: var(--text-muted);"></i></td><td><code class="md-key">Ctrl+F10</code></td><td>특수문자/이모티콘</td></tr>
                        <tr><td><i class="fa-solid fa-quote-left" style="font-size: 12px; color: var(--text-muted);"></i></td><td><code class="md-key">&gt; </code></td><td>인용구</td></tr>
                        <tr><td><span style="font-weight: 700; font-size: 11px; color: var(--text-muted); font-family: monospace;">&lt;/&gt;</span></td><td><code class="md-key">\`\`\` </code></td><td>코드 블록</td></tr>
                        <tr><td><i class="fa-solid fa-minus" style="font-size: 12px; color: var(--text-muted);"></i></td><td><code class="md-key">--- </code>, <code class="md-key">___ </code></td><td>구분선</td></tr>
                        <tr><td><i class="fa-solid fa-link" style="font-size: 12px; color: var(--text-muted);"></i></td><td><code class="md-key">[이름](링크) </code></td><td><span style="color: var(--accent); text-decoration: underline;">링크</span> (Ctrl+클릭 열기)</td></tr>
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 18px; display: flex; justify-content: flex-end; border-top: 1px solid var(--border); background: var(--surface);">
                <button type="button" id="closeMdHelpBottomBtn" style="padding: 0 18px; height: 34px; border: none; background: var(--accent); color: var(--accent-contrast); font-weight: 700; font-size: 13px; border-radius: 8px; cursor: pointer;">확인</button>
            </div>
        `;
        const closeFn = () => closeMarkdownHelpModal();
        modal.querySelector('#closeMdHelpTopBtn').onclick = closeFn;
        modal.querySelector('#closeMdHelpBottomBtn').onclick = closeFn;
        modal.onclick = (e) => { if (e.target === modal) closeFn(); };
        if (!modal.open) modal.showModal();
    }

    function closeMarkdownHelpModal() {
        const modal = document.getElementById('markdownHelpModal');
        if (modal && modal.open) modal.close();
        if (_activeQuill) {
            try { _activeQuill.focus(); } catch (e) {}
        }
    }

    // ========================================================================
    // 5. Main Mount / Unmount / Editor API
    // ========================================================================
    function unmount() {
        while (_cleanupFns.length) {
            const fn = _cleanupFns.pop();
            try { fn(); } catch (e) {}
        }
        _activeQuill = null;
        _mountOpts = null;
        _activeOverlayHost = null;
        _lastAutoConvertedList = null;
        _lastActiveTableCellTd = null;
        _savedSpecialCharRange = null;
        _pendingLinkState = null;
        _tableInsertRowBelowFn = null;
        _tableDeleteRowFn = null;
        _tableInsertColumnRightFn = null;
        _tableDeleteColumnFn = null;
        _createDefaultTableFn = null;
    }

    function mount(containerEl, opts = {}) {
        unmount();
        registerQuillOnce();
        if (!containerEl) return null;

        const Quill = global.Quill;
        _mountOpts = opts;
        _activeOverlayHost = opts.dialogHost || document.body;

        containerEl.innerHTML = '';
        containerEl.classList.add('little-note-scope');

        const box = document.createElement('div');
        box.className = 'little-note-editor-box';
        const editorMountEl = document.createElement('div');
        box.appendChild(editorMountEl);
        containerEl.appendChild(box);

        let quill = null;
        const handleImageFiles = async (files) => {
            const imgFiles = Array.from(files || []).filter(file => file && file.type && file.type.startsWith('image/'));
            if (!imgFiles.length || !quill) return;
            const readAsDataUrl = (file) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            for (const file of imgFiles) {
                try {
                    const dataUrl = await readAsDataUrl(file);
                    if (!dataUrl) continue;
                    const range = quill.getSelection(true) || { index: Math.max(0, quill.getLength() - 1), length: 0 };
                    const insertAt = range.index;
                    if (range.length > 0) quill.deleteText(insertAt, range.length, Quill.sources.USER);
                    quill.insertEmbed(insertAt, 'image', dataUrl, Quill.sources.USER);
                    quill.insertText(insertAt + 1, '\n', Quill.sources.USER);
                    quill.setSelection(insertAt + 2, 0, Quill.sources.SILENT);
                } catch (err) {}
            }
        };

        const customVideoHandler = () => {
            if (!quill) return;
            const input = global.prompt('동영상 주소(URL) 또는 소스 코드(iframe)를 붙여넣으세요:');
            if (!input) return;
            let url = input.trim();
            let videoTitle = '';
            if (url.includes('<iframe')) {
                const srcMatch = url.match(/src=["'](.*?)["']/);
                if (srcMatch && srcMatch[1]) url = srcMatch[1];
                const titleMatch = input.match(/title=["'](.*?)["']/);
                if (titleMatch && titleMatch[1] && !titleMatch[1].toLowerCase().includes('youtube video player')) {
                    videoTitle = titleMatch[1];
                }
            }
            if (url.includes('youtube.com/watch?v=')) url = url.replace('watch?v=', 'embed/').split('&')[0];
            else if (url.includes('youtu.be/')) url = url.replace('youtu.be/', 'youtube.com/embed/').split('?')[0];
            else if (url.includes('youtube.com/shorts/')) url = url.replace('youtube.com/shorts/', 'youtube.com/embed/').split('?')[0];
            if (!videoTitle) {
                videoTitle = global.prompt('동영상 제목을 입력해 주세요:\n(비워두면 기본 제목이 들어갑니다.)') || '첨부된 동영상';
            }
            const range = quill.getSelection(true) || { index: Math.max(0, quill.getLength() - 1), length: 0 };
            quill.insertText(range.index, videoTitle + '\n', Quill.sources.USER);
            quill.formatLine(range.index, 1, 'header', 3, Quill.sources.USER);
            const nextIndex = range.index + videoTitle.length + 1;
            quill.insertEmbed(nextIndex, 'video', url, Quill.sources.USER);
            quill.insertText(nextIndex + 1, '\n', Quill.sources.USER);
            quill.setSelection(nextIndex + 2, 0, Quill.sources.SILENT);
            if (opts && typeof opts.onToast === 'function') opts.onToast('동영상이 삽입되었습니다.');
        };

        const openLinkHandler = () => {
            const range = quill.getSelection() || { index: Math.max(0, quill.getLength() - 1), length: 0 };
            const fmt = quill.getFormat(range);
            let linkRange = range;
            let currentUrl = fmt && fmt.link ? fmt.link : '';
            if (currentUrl && range.length === 0) {
                const [leaf, offset] = quill.getLeaf(range.index);
                if (leaf && leaf.parent && leaf.parent.domNode && leaf.parent.domNode.tagName === 'A') {
                    const startIdx = quill.getIndex(leaf.parent);
                    const len = leaf.parent.length();
                    linkRange = { index: startIdx, length: len };
                } else {
                    void offset;
                }
            }
            const selText = linkRange.length > 0 ? quill.getText(linkRange.index, linkRange.length) : '';
            _pendingLinkState = { range: linkRange, hasSelection: linkRange.length > 0, isEdit: Boolean(currentUrl), existingUrl: currentUrl };
            if (opts && typeof opts.onOpenLinkModal === 'function') {
                opts.onOpenLinkModal({ selText, existingUrl: currentUrl, isEdit: Boolean(currentUrl) });
            }
        };

        quill = new Quill(editorMountEl, {
            theme: 'snow',
            bounds: box,
            placeholder: opts.placeholder || '상세 내용을 입력하세요...',
            modules: {
                syntax: global.hljs ? { hljs: global.hljs, languages: CODE_LANGUAGES } : false,
                table: true,
                history: { delay: 1000, maxStack: 100, userOnly: true },
                keyboard: {
                    bindings: {
                        // Strict Tab focus-trap: handled completely by capture listener below
                        'tab': { key: 'Tab', shiftKey: null, handler: () => false },
                        'list autofill': {
                            key: ' ',
                            shiftKey: null,
                            collapsed: true,
                            format: { 'code-block': false, blockquote: false, table: false },
                            prefix: /^\s*?(\d+\.|-|\*|\[ ?\]|\[x\])$/,
                            handler: function (range, context) {
                                if (this.quill.scroll.query('list') == null) return true;
                                const length = context.prefix.length;
                                const [line, offset] = this.quill.getLine(range.index);
                                if (offset > length) return true;
                                void line;
                                let value;
                                const trimmed = context.prefix.trim();
                                switch (trimmed) {
                                    case '[]':
                                    case '[ ]': value = 'unchecked'; break;
                                    case '[x]': value = 'checked'; break;
                                    case '-':
                                    case '*': value = 'bullet'; break;
                                    default: value = 'ordered';
                                }
                                _lastAutoConvertedList = { lineIndex: range.index - length, prefix: trimmed, isInsideQuote: false, timestamp: Date.now() };
                                this.quill.deleteText(range.index - length, length, Quill.sources.USER);
                                this.quill.formatLine(range.index - length, 1, 'list', value, Quill.sources.USER);
                                this.quill.setSelection(range.index - length, Quill.sources.SILENT);
                                return false;
                            }
                        },
                        'smart-list-undo': {
                            key: 'Backspace',
                            handler: function (range) {
                                if (!_lastAutoConvertedList) return true;
                                if (Date.now() - _lastAutoConvertedList.timestamp < 6000) {
                                    const [line] = this.quill.getLine(range.index);
                                    if (line && line.formats().list) {
                                        const lineIndex = this.quill.getIndex(line);
                                        const prefixToRestore = _lastAutoConvertedList.prefix + ' ';
                                        const isInsideQuote = _lastAutoConvertedList.isInsideQuote;
                                        _lastAutoConvertedList = null;
                                        this.quill.formatLine(lineIndex, 1, 'list', false, Quill.sources.USER);
                                        if (isInsideQuote) {
                                            this.quill.formatLine(lineIndex, 1, 'quote-item', false, Quill.sources.USER);
                                            this.quill.formatLine(lineIndex, 1, 'blockquote', true, Quill.sources.USER);
                                        }
                                        this.quill.insertText(lineIndex, prefixToRestore, Quill.sources.USER);
                                        this.quill.setSelection(lineIndex + prefixToRestore.length, Quill.sources.USER);
                                        return false;
                                    }
                                }
                                _lastAutoConvertedList = null;
                                return true;
                            }
                        },
                        'table-cell-ctrl-enter': {
                            key: 'Enter',
                            shortKey: true,
                            format: ['table'],
                            handler: function (range) {
                                const tableModule = this.quill.getModule('table');
                                if (tableModule) {
                                    const [table] = tableModule.getTable(range);
                                    if (table) {
                                        const tableEnd = table.offset() + table.length();
                                        const Delta = Quill.import('delta');
                                        this.quill.updateContents(new Delta().retain(tableEnd).insert('\n'), Quill.sources.USER);
                                        this.quill.setSelection(tableEnd, Quill.sources.USER);
                                        return false;
                                    }
                                }
                                return true;
                            }
                        },
                        'table enter': {
                            key: 'Enter',
                            shiftKey: null,
                            format: ['table'],
                            handler: function (range) {
                                const tableModule = this.quill.getModule('table');
                                if (!tableModule) return true;
                                const [table, row] = tableModule.getTable(range);
                                if (!table || !row) return true;
                                const Delta = Quill.import('delta');
                                if (row.prev == null) {
                                    const tableStart = table.offset();
                                    const delta = new Delta();
                                    if (tableStart > 0) delta.retain(tableStart);
                                    delta.insert('\n');
                                    this.quill.updateContents(delta, Quill.sources.USER);
                                    this.quill.setSelection(tableStart, Quill.sources.USER);
                                    return false;
                                } else if (row.next == null) {
                                    const tableEnd = table.offset() + table.length();
                                    this.quill.updateContents(new Delta().retain(tableEnd).insert('\n'), Quill.sources.USER);
                                    this.quill.setSelection(tableEnd, Quill.sources.USER);
                                    return false;
                                }
                                return false;
                            }
                        },
                        'quote-item enter': {
                            key: 'Enter',
                            collapsed: true,
                            format: ['quote-item'],
                            empty: false,
                            handler: function (range, context) {
                                const [line] = this.quill.getLine(range.index);
                                const lineFormats = (line && typeof line.formats === 'function') ? line.formats() : {};
                                const listFormat = (context.format && context.format.list) || lineFormats.list || 'bullet';
                                const nextList = (listFormat === 'checked') ? 'unchecked' : listFormat;
                                const indentVal = (context.format && context.format.indent) || lineFormats.indent;
                                const fmtObj = { 'list': nextList, 'quote-item': true };
                                if (indentVal) fmtObj.indent = indentVal;
                                this.quill.insertText(range.index, '\n', Quill.sources.USER);
                                this.quill.formatLine(range.index + 1, 1, fmtObj, Quill.sources.USER);
                                this.quill.setSelection(range.index + 1, 0, Quill.sources.SILENT);
                                return false;
                            }
                        },
                        'quote-item empty enter': {
                            key: 'Enter',
                            collapsed: true,
                            format: ['quote-item'],
                            empty: true,
                            handler: function (range, context) {
                                const [line] = this.quill.getLine(range.index);
                                const lineFormats = (line && typeof line.formats === 'function') ? line.formats() : {};
                                const curIndent = parseInt((context.format && context.format.indent) || lineFormats.indent || 0, 10) || 0;
                                if (curIndent > 0) {
                                    this.quill.formatLine(range.index, 1, 'indent', curIndent > 1 ? curIndent - 1 : false, Quill.sources.USER);
                                    this.quill.formatLine(range.index, 1, 'quote-item', true, Quill.sources.USER);
                                    return false;
                                }
                                this.quill.formatLine(range.index, 1, 'list', false, Quill.sources.USER);
                                this.quill.formatLine(range.index, 1, 'quote-item', false, Quill.sources.USER);
                                this.quill.formatLine(range.index, 1, 'blockquote', true, Quill.sources.USER);
                                return false;
                            }
                        },
                        'blockquote empty enter': {
                            key: 'Enter',
                            collapsed: true,
                            format: ['blockquote'],
                            empty: true,
                            handler: function (range) {
                                this.quill.formatLine(range.index, 1, 'blockquote', false, Quill.sources.USER);
                                return false;
                            }
                        },
                        'code-block smart list enter': {
                            key: 'Enter',
                            collapsed: true,
                            shiftKey: false,
                            format: ['code-block'],
                            handler: function (range, context) {
                                const [line, offset] = this.quill.getLine(range.index);
                                const lineFormats = (line && typeof line.formats === 'function') ? line.formats() : context.format;
                                if (!isLineCodeBlock(line, lineFormats)) return true;
                                const rawText = (line && line.domNode) ? (line.domNode.textContent || '') : '';
                                const match = rawText.match(/^([ \t]*)(\u2610 |\u2611 |\u2022 |(\d+)\. )(.*)$/);
                                if (!match) return true;
                                const indent = match[1], prefix = match[2], numStr = match[3], rest = match[4];
                                if (offset < indent.length) return true;
                                if (rest.trim() === '' && offset >= indent.length + prefix.length) {
                                    const lineStart = this.quill.getIndex(line);
                                    this.quill.deleteText(lineStart + indent.length, prefix.length, Quill.sources.USER);
                                    this.quill.setSelection(lineStart + indent.length, 0, Quill.sources.SILENT);
                                    return false;
                                }
                                let nextPrefix = prefix;
                                if (prefix === '\u2611 ' || prefix === '\u2610 ') nextPrefix = '\u2610 ';
                                else if (numStr) nextPrefix = `${parseInt(numStr, 10) + 1}. `;
                                const codeBlockVal = (lineFormats && lineFormats['code-block']) || (context.format && context.format['code-block']) || true;
                                const Delta = Quill.import('delta');
                                const delta = new Delta();
                                if (range.index > 0) delta.retain(range.index);
                                delta.insert('\n', { 'code-block': codeBlockVal }).insert(indent + nextPrefix);
                                this.quill.updateContents(delta, Quill.sources.USER);
                                this.quill.setSelection(range.index + 1 + indent.length + nextPrefix.length, 0, Quill.sources.SILENT);
                                return false;
                            }
                        }
                    }
                },
                clipboard: {
                    matchers: [
                        [Node.ELEMENT_NODE, function (node, delta) {
                            delta.ops.forEach(op => {
                                if (op.attributes) {
                                    delete op.attributes.color;
                                    delete op.attributes.background;
                                    delete op.attributes.font;
                                }
                            });
                            return delta;
                        }]
                    ]
                },
                toolbar: {
                    container: TOOLBAR_CONTAINER,
                    handlers: {
                        'special-char': function () {
                            _savedSpecialCharRange = this.quill.getSelection();
                            if (opts && typeof opts.onOpenSpecialChar === 'function') opts.onOpenSpecialChar();
                        },
                        'markdown-help': function () {
                            openMarkdownHelpModal();
                        },
                        'list': function (value) {
                            const range = this.quill.getSelection();
                            if (!range) return;
                            const targetLen = range.length > 0 ? range.length : 1;
                            const lines = this.quill.getLines(range.index, targetLen) || [];
                            if (lines.length > 0 && lines.every((l) => isLineCodeBlock(l, typeof l.formats === 'function' ? l.formats() : null))) {
                                toggleCodeBlockListPrefix(this.quill, range, value);
                                return;
                            }
                            const formats = this.quill.getFormat(range);
                            const [line] = this.quill.getLine(range.index);
                            const lineFormats = (line && typeof line.formats === 'function') ? line.formats() : formats;
                            const currentList = formats.list || lineFormats.list;
                            let targetList;
                            if (value === 'check') {
                                targetList = (currentList === 'checked' || currentList === 'unchecked' || currentList === 'check') ? false : 'unchecked';
                            } else {
                                targetList = (currentList === value) ? false : value;
                            }
                            const editableSnapshots = lines
                                .filter((l) => !isLineCodeBlock(l, typeof l.formats === 'function' ? l.formats() : null))
                                .map((l) => ({
                                    idx: this.quill.getIndex(l),
                                    inQuote: isLineInQuote(l, typeof l.formats === 'function' ? l.formats() : {})
                                }));
                            if (!editableSnapshots.length) return;
                            editableSnapshots.forEach((item) => {
                                this.quill.formatLine(item.idx, 1, 'list', targetList, Quill.sources.USER);
                                if (item.inQuote) {
                                    if (targetList) this.quill.formatLine(item.idx, 1, 'quote-item', true, Quill.sources.USER);
                                    else {
                                        this.quill.formatLine(item.idx, 1, 'quote-item', false, Quill.sources.USER);
                                        this.quill.formatLine(item.idx, 1, 'blockquote', true, Quill.sources.USER);
                                    }
                                }
                            });
                        },
                        'blockquote': function () {
                            const range = this.quill.getSelection();
                            if (!range) return;
                            const targetLen = range.length > 0 ? range.length : 1;
                            const lines = this.quill.getLines(range.index, targetLen) || [];
                            const editableLines = lines.filter((l) => !isLineCodeBlock(l, typeof l.formats === 'function' ? l.formats() : null));
                            if (!editableLines.length) return;
                            const allQuoted = editableLines.every((l) => isLineInQuote(l, typeof l.formats === 'function' ? l.formats() : {}));
                            const nextState = !allQuoted;
                            editableLines.forEach((l) => {
                                const idx = this.quill.getIndex(l);
                                const lf = (typeof l.formats === 'function') ? l.formats() : {};
                                const hasList = !!(lf.list || (l.domNode && l.domNode.tagName === 'LI'));
                                if (hasList) this.quill.formatLine(idx, 1, 'quote-item', nextState, Quill.sources.USER);
                                else this.quill.formatLine(idx, 1, 'blockquote', nextState, Quill.sources.USER);
                            });
                        },
                        'link': function (value) {
                            if (value) {
                                openLinkHandler();
                            } else {
                                this.quill.format('link', false);
                            }
                        },
                        'undo': function () { this.quill.history.undo(); },
                        'redo': function () { this.quill.history.redo(); },
                        'table': function () { if (_createDefaultTableFn) _createDefaultTableFn(); },
                        'table-insert-row': function () { if (_tableInsertRowBelowFn) _tableInsertRowBelowFn(); },
                        'table-delete-row': function () { if (_tableDeleteRowFn) _tableDeleteRowFn(); },
                        'table-insert-column': function () { if (_tableInsertColumnRightFn) _tableInsertColumnRightFn(); },
                        'table-delete-column': function () { if (_tableDeleteColumnFn) _tableDeleteColumnFn(); },
                        'video': customVideoHandler,
                        'image': function () {
                            const input = document.createElement('input');
                            input.setAttribute('type', 'file');
                            input.setAttribute('accept', 'image/*');
                            input.setAttribute('multiple', 'multiple');
                            input.onchange = () => {
                                if (input.files && input.files.length) handleImageFiles(input.files);
                            };
                            input.click();
                        },
                        'highlight': function () {
                            const range = this.quill.getSelection(true);
                            if (!range) return;
                            const curFmt = this.quill.getFormat(range);
                            const curBg = curFmt && curFmt.background ? String(curFmt.background).toLowerCase() : '';
                            const isYellow = curBg === '#fef08a' || curBg === 'rgb(254, 240, 138)';
                            this.quill.format('background', isYellow ? false : '#fef08a', Quill.sources.USER);
                        },
                        'strike-line': function () {
                            const range = this.quill.getSelection();
                            if (!range) return;
                            const [line] = this.quill.getLine(range.index);
                            const lineIndex = this.quill.getIndex(line);
                            const lineLength = line.length() - 1;
                            const isStruck = lineLength === 0 ? this.quill.getFormat(range)['strike-line'] : this.quill.getFormat(lineIndex, 1)['strike-line'];
                            if (isStruck) {
                                if (lineLength > 0) this.quill.formatText(lineIndex, lineLength, 'strike-line', false, Quill.sources.USER);
                                this.quill.format('strike-line', false, Quill.sources.USER);
                            } else {
                                if (lineLength > 0) {
                                    this.quill.formatText(lineIndex, lineLength, 'strike-line', true, Quill.sources.USER);
                                    const lineEnd = lineIndex + lineLength;
                                    this.quill.insertText(lineEnd, '\u200B', Quill.sources.USER);
                                    this.quill.setSelection(lineEnd + 1, Quill.sources.SILENT);
                                    this.quill.format('strike-line', false, Quill.sources.USER);
                                } else {
                                    this.quill.format('strike-line', true, Quill.sources.USER);
                                }
                            }
                        },
                        'divider': function () {
                            const range = this.quill.getSelection(true);
                            if (!range) return;
                            const [line] = this.quill.getLine(range.index);
                            if (!line) return;
                            const lineStart = this.quill.getIndex(line);
                            const Delta = Quill.import('delta');
                            if (line.length() <= 1) {
                                const delta = new Delta();
                                if (lineStart > 0) delta.retain(lineStart);
                                delta.delete(1).insert({ divider: true }).insert('\n');
                                this.quill.updateContents(delta, Quill.sources.USER);
                                this.quill.setSelection(lineStart + 1, 0, Quill.sources.USER);
                            } else {
                                const lineEnd = lineStart + line.length();
                                const delta = new Delta();
                                if (lineEnd > 0) delta.retain(lineEnd);
                                delta.insert({ divider: true }).insert('\n');
                                this.quill.updateContents(delta, Quill.sources.USER);
                                this.quill.setSelection(lineEnd + 1, 0, Quill.sources.USER);
                            }
                        }
                    }
                }
            }
        });

        _activeQuill = quill;

        // Wire toolbar tooltips and prevent button focus theft on toolbar
        const toolbarModule = quill.getModule('toolbar');
        const toolbarRoot = toolbarModule ? toolbarModule.container : box.querySelector('.ql-toolbar');
        initToolbarTooltips(toolbarRoot);
        if (toolbarRoot) {
            toolbarRoot.querySelectorAll('button, .ql-picker-label').forEach(el => el.setAttribute('tabindex', '-1'));
        }

        // Load Initial Data (Quill HTML verbatim, OR legacy Markdown -> Quill HTML)
        const initialRaw = String(opts.initialValue || '').trim();
        if (initialRaw) {
            if (isQuillHtml(initialRaw)) {
                quill.root.innerHTML = initialRaw;
            } else {
                const converted = legacyMarkdownToQuillHtml(initialRaw);
                if (converted) quill.root.innerHTML = converted;
            }
            if (quill.history && typeof quill.history.clear === 'function') quill.history.clear();
        }

        // Initialize sub-engines (Table, Image Resizer/Lightbox/Menu, CodeBlock Tooltips)
        const tableApi = setupTableEngine(quill, _activeOverlayHost, opts);
        setupImageResizerLightboxAndMenu(quill, box.querySelector('.ql-container'), _activeOverlayHost, opts);
        setupCodeBlockInteractions(quill, _activeOverlayHost, opts);

        // STRICT FOCUS TRAP & KEYBOARD HANDLERS (capture: true on quill.root)
        const onRootKeyDownCapture = (e) => {
            // 1. TAB / SHIFT+TAB: MUST NEVER leave the editor!
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if (e.isComposing) return;

                const range = quill.getSelection(true) || quill.getSelection();
                if (!range) return;

                // 1A. Inside Table Cell -> navigate cell to cell / auto-append row at last cell
                if (tableApi && tableApi.isCursorInTable()) {
                    const sel = global.getSelection();
                    let curCell = null;
                    if (sel && sel.anchorNode) {
                        const n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
                        if (n && quill.root.contains(n)) curCell = n.closest('td, th');
                    }
                    if (!curCell) {
                        const [line] = quill.getLine(range.index);
                        curCell = line && line.domNode && line.domNode.closest ? line.domNode.closest('td, th') : null;
                    }
                    if (curCell) {
                        const tableEl = curCell.closest('table');
                        const allCells = tableEl ? Array.from(tableEl.querySelectorAll('td, th')) : [];
                        const curIdx = allCells.indexOf(curCell);
                        if (curIdx !== -1) {
                            const nextIdx = e.shiftKey ? curIdx - 1 : curIdx + 1;
                            if (nextIdx >= 0 && nextIdx < allCells.length) {
                                const targetBlot = Quill.find(allCells[nextIdx]);
                                if (targetBlot && typeof targetBlot.offset === 'function') {
                                    quill.setSelection(targetBlot.offset(quill.scroll), 0, Quill.sources.USER);
                                    _lastActiveTableCellTd = allCells[nextIdx];
                                    return;
                                }
                            } else if (!e.shiftKey) {
                                tableApi.tableInsertRowBelowSafe(true);
                                return;
                            }
                            return;
                        }
                    }
                }

                // 1B. List items (checklist / bullet / ordered, including quote-item): multi-level indent!
                const targetLen = range.length > 0 ? range.length : 1;
                const lines = quill.getLines(range.index, targetLen) || [];
                const anyList = lines.some(l => {
                    const fmts = typeof l.formats === 'function' ? l.formats() : {};
                    return Boolean(fmts.list || (l.domNode && l.domNode.tagName === 'LI'));
                });
                if (anyList) {
                    lines.forEach(l => {
                        const fmts = typeof l.formats === 'function' ? l.formats() : {};
                        if (!fmts.list && !(l.domNode && l.domNode.tagName === 'LI')) return;
                        const curIndent = parseInt(fmts.indent || 0, 10) || 0;
                        const nextIndent = e.shiftKey ? Math.max(0, curIndent - 1) : Math.min(8, curIndent + 1);
                        const idx = quill.getIndex(l);
                        quill.formatLine(idx, 1, 'indent', nextIndent > 0 ? nextIndent : false, Quill.sources.USER);
                        if (isLineInQuote(l, fmts)) {
                            quill.formatLine(idx, 1, 'quote-item', true, Quill.sources.USER);
                        }
                    });
                    return;
                }

                // 1C. Code-block or standard paragraph: indent / outdent 4 spaces
                if (!e.shiftKey) {
                    if (range.length > 0) quill.deleteText(range.index, range.length, Quill.sources.USER);
                    quill.insertText(range.index, '    ', Quill.sources.USER);
                    quill.setSelection(range.index + 4, 0, Quill.sources.SILENT);
                } else {
                    const [line] = quill.getLine(range.index);
                    if (line && line.domNode) {
                        const lStart = quill.getIndex(line);
                        const rawText = line.domNode.textContent || '';
                        const leadMatch = rawText.match(/^(\t| {1,4})/);
                        if (leadMatch) {
                            const delLen = leadMatch[1].length;
                            quill.deleteText(lStart, delLen, Quill.sources.USER);
                            quill.setSelection(Math.max(lStart, range.index - delLen), 0, Quill.sources.SILENT);
                        }
                    }
                }
                return;
            }

            // 2. Smart Backspace to restore auto-converted list prefix
            if (e.key === 'Backspace' && !e.isComposing && _lastAutoConvertedList) {
                if (Date.now() - _lastAutoConvertedList.timestamp < 10000) {
                    const sel = quill.getSelection();
                    if (sel) {
                        const [line] = quill.getLine(sel.index);
                        if (line && line.formats().list) {
                            const lineText = line.domNode ? line.domNode.textContent : '';
                            if (!lineText || lineText.trim() === '' || sel.index <= _lastAutoConvertedList.lineIndex + 1) {
                                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                                const lineIndex = quill.getIndex(line);
                                const prefixToRestore = _lastAutoConvertedList.prefix + ' ';
                                const isInsideQuote = _lastAutoConvertedList.isInsideQuote;
                                _lastAutoConvertedList = null;
                                quill.formatLine(lineIndex, 1, 'list', false, Quill.sources.USER);
                                if (isInsideQuote) {
                                    quill.formatLine(lineIndex, 1, 'quote-item', false, Quill.sources.USER);
                                    quill.formatLine(lineIndex, 1, 'blockquote', true, Quill.sources.USER);
                                }
                                quill.insertText(lineIndex, prefixToRestore, Quill.sources.USER);
                                quill.setSelection(lineIndex + prefixToRestore.length, Quill.sources.USER);
                                return;
                            }
                        }
                    }
                }
                _lastAutoConvertedList = null;
            }

            // 3. Shift+Enter SoftBreak inside Table or Quote
            if (e.key === 'Enter' && e.shiftKey) {
                const selection = global.getSelection();
                let cell = null;
                if (selection && selection.rangeCount > 0) {
                    const node = selection.anchorNode;
                    cell = node && node.nodeType === 1 ? node.closest('td, th') : (node && node.parentElement ? node.parentElement.closest('td, th') : null);
                }
                const curRange = quill.getSelection(true) || quill.getSelection();
                let inQuote = false;
                if (curRange) {
                    const formats = quill.getFormat(curRange);
                    inQuote = Boolean(formats.blockquote || formats['quote-item']);
                }
                if (cell || inQuote) {
                    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                    if (curRange) {
                        quill.insertEmbed(curRange.index, 'softbreak', true, Quill.sources.USER);
                        quill.setSelection(curRange.index + 1, 0, Quill.sources.USER);
                    }
                    return;
                }
            }

            // 4. Ctrl+K Link Modal shortcut
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault(); e.stopPropagation();
                openLinkHandler();
                return;
            }
        };

        // Click on anchor (Ctrl+click or regular click on local/web link inside editor -> open cleanly)
        const onRootLinkClick = (e) => {
            const anchor = e.target.closest('a');
            if (!anchor) return;
            const rawHref = anchor.getAttribute('href') || '';
            if (e.ctrlKey || e.metaKey) {
                if (openExternalTarget(rawHref, opts)) {
                    e.preventDefault(); e.stopPropagation();
                }
            }
        };

        // Paste Image Support
        const onPasteCapture = (e) => {
            const clipboard = e.clipboardData || global.clipboardData;
            if (!clipboard) return;
            let pastedFiles = [];
            if (clipboard.items) {
                for (let i = 0; i < clipboard.items.length; i++) {
                    if (clipboard.items[i].type && clipboard.items[i].type.startsWith('image/')) {
                        const f = clipboard.items[i].getAsFile();
                        if (f) pastedFiles.push(f);
                    }
                }
            }
            if (pastedFiles.length === 0 && clipboard.files && clipboard.files.length > 0) {
                pastedFiles = Array.from(clipboard.files).filter(f => f && f.type && f.type.startsWith('image/'));
            }
            if (pastedFiles.length === 0) return;

            const htmlData = clipboard.getData ? (clipboard.getData('text/html') || '') : '';
            const plainData = clipboard.getData ? (clipboard.getData('text/plain') || '') : '';
            let hasRichTextPayload = Boolean(plainData && plainData.trim().length > 0);
            if (!hasRichTextPayload && htmlData) {
                try {
                    const doc = new DOMParser().parseFromString(htmlData, 'text/html');
                    const imgs = doc.body ? doc.body.querySelectorAll('img') : [];
                    const textLen = (doc.body ? (doc.body.textContent || '') : '').replace(/[\u200B\u00A0\s]/g, '').length;
                    const hasEditorImg = Array.from(imgs).some(im => im.hasAttribute('data-size') || (im.getAttribute('style') || '').includes('width'));
                    if (textLen > 0 || imgs.length > 1 || hasEditorImg) hasRichTextPayload = true;
                } catch (err) {}
            }
            if (!hasRichTextPayload) {
                e.preventDefault(); e.stopPropagation();
                handleImageFiles(pastedFiles);
            }
        };

        // Drag & drop image insertion
        const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
        const onDrop = (e) => {
            e.preventDefault(); e.stopPropagation();
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length > 0) {
                const imgs = Array.from(dt.files).filter(f => f && f.type && f.type.startsWith('image/'));
                if (imgs.length > 0) handleImageFiles(imgs);
            }
        };

        // Legacy data-list="check" normalization
        const onCheckLegacyClick = (e) => {
            const ui = e.target.closest('.ql-ui');
            const li = e.target.closest('li[data-list="check"]');
            if (li && (ui || e.target === li)) li.setAttribute('data-list', 'checked');
        };

        // K-Markdown Space trigger engine (verbatim MY 노트 V1.5.1)
        const onTextChange = (delta, oldDelta, source) => {
            if (source !== 'user') return;
            const ops = delta.ops;
            if (!ops || ops.length < 2) return;
            const lastOp = ops[ops.length - 1];
            if (lastOp.insert !== ' ') return;

            const range = quill.getSelection();
            if (!range) return;
            const [line, offset] = quill.getLine(range.index);
            if (!line || !line.domNode) return;
            const text = line.domNode.textContent.substring(0, offset);
            const lineStart = quill.getIndex(line);
            const lineFormats = (line && typeof line.formats === 'function') ? line.formats() : quill.getFormat(lineStart);
            if (isLineCodeBlock(line, lineFormats)) return;

            const tableMatch = text.match(/^\|(.+)\|\s$/);
            if (tableMatch) {
                const inner = tableMatch[1].trim();
                let rows = 2, cols = 2, headers = [];
                const dimMatch = inner.match(/^(\d+)[xX](\d+)$/);
                if (dimMatch) {
                    rows = Math.min(10, Math.max(1, parseInt(dimMatch[1], 10)));
                    cols = Math.min(10, Math.max(1, parseInt(dimMatch[2], 10)));
                } else {
                    headers = inner.split('|').map(c => c.trim()).filter(c => c.length > 0);
                    cols = Math.max(2, headers.length);
                    rows = 2;
                }
                const tableModule = quill.getModule('table');
                if (tableModule) {
                    quill.deleteText(lineStart, offset, Quill.sources.USER);
                    tableModule.insertTable(rows, cols);
                    if (headers.length > 0 && !dimMatch) {
                        setTimeout(() => {
                            const sel = quill.getSelection();
                            const anchor = sel ? sel.index : lineStart;
                            const [curLine] = quill.getLine(anchor);
                            const tableNode = (curLine && curLine.domNode && curLine.domNode.closest && curLine.domNode.closest('table')) || quill.root.querySelector('table:last-of-type');
                            if (tableNode) {
                                tableNode.querySelectorAll('tr:first-child td').forEach((td, idx) => {
                                    if (headers[idx]) td.textContent = headers[idx];
                                });
                            }
                        }, 20);
                    }
                    return;
                }
            }

            const blockMatch = text.match(/^(#{1,6}|>\s*(?:\*|-|\+)\s+\[\s?\]|>\s*(?:\*|-|\+)\s+\[x\]|>\s*\[\s?\]|>\s*\[x\]|>\s*\d+\.|>\s*(?:\*|-|\+)|>|(?:\*|-|\+)\s+\[\s?\]|(?:\*|-|\+)\s+\[x\]|\*|-|\+|\d+\.|\-{3}|_{3}|\*{3}|`{3}[a-zA-Z0-9_\-+]*|\[\s?\]|\[x\])\s$/i);
            if (blockMatch) {
                const prefix = blockMatch[1];
                const isListPrefix = /^(\*|-|\+|\d+\.|\[\s?\]|\[x\]|(?:\*|-|\+)\s+\[\s?\]|(?:\*|-|\+)\s+\[x\]|>\s*(?:\*|-|\+)|>\s*\d+\.|>\s*(?:\*|-|\+)\s+\[\s?\]|>\s*(?:\*|-|\+)\s+\[x\]|>\s*\[\s?\]|>\s*\[x\])$/i.test(prefix);
                const deleteLength = prefix.length + 1;
                const formatIndex = range.index - deleteLength;
                const curLineFormats = (line && typeof line.formats === 'function') ? line.formats() : quill.getFormat(formatIndex);
                const isInsideQuote = isLineInQuote(line, curLineFormats);

                quill.deleteText(formatIndex, deleteLength, Quill.sources.USER);
                _lastAutoConvertedList = isListPrefix ? { lineIndex: formatIndex, prefix, isInsideQuote, timestamp: Date.now() } : null;

                if (/^#{1,6}$/.test(prefix)) {
                    quill.formatLine(formatIndex, 1, 'header', prefix.length, Quill.sources.SILENT);
                } else if (/^>\s*(?:\*|-|\+)\s+\[\s?\]$/i.test(prefix) || /^>\s*\[\s?\]$/i.test(prefix)) {
                    quill.formatLine(formatIndex, 1, 'list', 'unchecked', Quill.sources.USER);
                    quill.formatLine(formatIndex, 1, 'quote-item', true, Quill.sources.USER);
                } else if (/^>\s*(?:\*|-|\+)\s+\[x\]$/i.test(prefix) || /^>\s*\[x\]$/i.test(prefix)) {
                    quill.formatLine(formatIndex, 1, 'list', 'checked', Quill.sources.USER);
                    quill.formatLine(formatIndex, 1, 'quote-item', true, Quill.sources.USER);
                } else if (/^>\s*\d+\.$/i.test(prefix)) {
                    quill.formatLine(formatIndex, 1, 'list', 'ordered', Quill.sources.USER);
                    quill.formatLine(formatIndex, 1, 'quote-item', true, Quill.sources.USER);
                } else if (/^>\s*(\*|-|\+)$/i.test(prefix)) {
                    quill.formatLine(formatIndex, 1, 'list', 'bullet', Quill.sources.USER);
                    quill.formatLine(formatIndex, 1, 'quote-item', true, Quill.sources.USER);
                } else if (prefix === '>') {
                    quill.formatLine(formatIndex, 1, 'blockquote', true, Quill.sources.SILENT);
                } else if (/^(\*|-|\+)\s+\[\s?\]$/i.test(prefix) || /^\[\s?\]$/.test(prefix)) {
                    quill.formatLine(formatIndex, 1, 'list', 'unchecked', Quill.sources.USER);
                    if (isInsideQuote) quill.formatLine(formatIndex, 1, 'quote-item', true, Quill.sources.USER);
                } else if (/^(\*|-|\+)\s+\[x\]$/i.test(prefix) || /^\[x\]$/i.test(prefix)) {
                    quill.formatLine(formatIndex, 1, 'list', 'checked', Quill.sources.USER);
                    if (isInsideQuote) quill.formatLine(formatIndex, 1, 'quote-item', true, Quill.sources.USER);
                } else if (prefix === '*' || prefix === '-' || prefix === '+') {
                    quill.formatLine(formatIndex, 1, 'list', 'bullet', Quill.sources.USER);
                    if (isInsideQuote) quill.formatLine(formatIndex, 1, 'quote-item', true, Quill.sources.USER);
                } else if (/^\d+\.$/.test(prefix)) {
                    quill.formatLine(formatIndex, 1, 'list', 'ordered', Quill.sources.USER);
                    if (isInsideQuote) quill.formatLine(formatIndex, 1, 'quote-item', true, Quill.sources.USER);
                } else if (prefix === '---' || prefix === '___' || prefix === '***') {
                    const Delta = Quill.import('delta');
                    const delta = new Delta();
                    if (formatIndex > 0) delta.retain(formatIndex);
                    delta.insert({ divider: true });
                    if (formatIndex >= quill.getLength() - 1) delta.insert('\n');
                    quill.updateContents(delta, Quill.sources.USER);
                    quill.setSelection(formatIndex + 1, 0, Quill.sources.USER);
                } else if (/^`{3}/.test(prefix)) {
                    let lang = prefix.replace(/^`{3}/, '').toLowerCase().trim();
                    const aliases = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', 'c++': 'cpp', 'c#': 'csharp', yml: 'yaml', md: 'markdown', htm: 'html' };
                    if (aliases[lang]) lang = aliases[lang];
                    quill.formatLine(formatIndex, 1, 'code-block', lang || true, Quill.sources.USER);
                }
                return;
            }

            const fullText = quill.getText(lineStart, offset);
            function applyInlineFormat(matchText, content, formatName, formatValue = true) {
                const start = lineStart + offset - matchText.length;
                const hasKorean = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(content);
                setTimeout(() => {
                    quill.deleteText(start, matchText.length, Quill.sources.USER);
                    quill.insertText(start, content, { [formatName]: formatValue }, Quill.sources.USER);
                    if (hasKorean) {
                        quill.insertText(start + content.length, '\u200B', { [formatName]: false }, Quill.sources.USER);
                        quill.setSelection(start + content.length + 1, Quill.sources.SILENT);
                        quill.format(formatName, false, Quill.sources.USER);
                    } else {
                        quill.insertText(start + content.length, ' ', { [formatName]: false }, Quill.sources.USER);
                        quill.setSelection(start + content.length + 1, Quill.sources.SILENT);
                    }
                }, 10);
            }

            const boldMatch = fullText.match(/\*\*(.+?)\*\* $/);
            if (boldMatch) { applyInlineFormat(boldMatch[0], boldMatch[1], 'bold'); return; }
            const strikeMatch = fullText.match(/~~(.+?)~~ $/);
            if (strikeMatch) { applyInlineFormat(strikeMatch[0], strikeMatch[1], 'strike'); return; }
            const highlightMatch = fullText.match(/==(.+?)== $/);
            if (highlightMatch) { applyInlineFormat(highlightMatch[0], highlightMatch[1], 'background', '#fef08a'); return; }
            const underMatch = fullText.match(/__(.+?)__ $/);
            if (underMatch) { applyInlineFormat(underMatch[0], underMatch[1], 'underline'); return; }
            const italicMatch = fullText.match(/(\*|_)(.+?)\1 $/);
            if (italicMatch) { applyInlineFormat(italicMatch[0], italicMatch[2], 'italic'); return; }
            const codeMatch = fullText.match(/`([^`]+)` $/);
            if (codeMatch) { applyInlineFormat(codeMatch[0], codeMatch[1], 'code'); return; }

            const linkMdMatch = fullText.match(/\[([^\]]+)\]\(([^)]+)\) $/);
            if (linkMdMatch) {
                const matchedStr = linkMdMatch[0], label = linkMdMatch[1].trim(), rawUrl = linkMdMatch[2].trim();
                if (label && rawUrl) {
                    const cleanUrl = normalizeLinkInput(rawUrl);
                    const start = range.index - matchedStr.length;
                    setTimeout(() => {
                        quill.deleteText(start, matchedStr.length, Quill.sources.USER);
                        quill.insertText(start, label, 'link', cleanUrl, Quill.sources.USER);
                        quill.insertText(start + label.length, ' ', { link: false }, Quill.sources.USER);
                        quill.setSelection(start + label.length + 1, 0, Quill.sources.SILENT);
                        quill.format('link', false, Quill.sources.SILENT);
                    }, 10);
                }
            }
        };

        quill.root.addEventListener('keydown', onRootKeyDownCapture, true);
        quill.root.addEventListener('click', onRootLinkClick);
        quill.root.addEventListener('click', onCheckLegacyClick, true);
        quill.root.addEventListener('paste', onPasteCapture, true);
        quill.root.addEventListener('dragover', onDragOver);
        quill.root.addEventListener('drop', onDrop, true);
        quill.on('text-change', onTextChange);

        _cleanupFns.push(() => {
            quill.root.removeEventListener('keydown', onRootKeyDownCapture, true);
            quill.root.removeEventListener('click', onRootLinkClick);
            quill.root.removeEventListener('click', onCheckLegacyClick, true);
            quill.root.removeEventListener('paste', onPasteCapture, true);
            quill.root.removeEventListener('dragover', onDragOver);
            quill.root.removeEventListener('drop', onDrop, true);
        });

        return quill;
    }

    function getPlainText() {
        if (!_activeQuill) return '';
        return (_activeQuill.getText() || '').replace(/\u200B/g, '').trim();
    }

    function hasMediaOrEmbeds() {
        if (!_activeQuill || !_activeQuill.root) return false;
        return Boolean(_activeQuill.root.querySelector('img, iframe, hr, table, .ql-code-block-container'));
    }

    function getHtml() {
        if (!_activeQuill || !_activeQuill.root) return '';
        if (!getPlainText() && !hasMediaOrEmbeds()) return '';
        const clone = _activeQuill.root.cloneNode(true);
        clone.querySelectorAll('img.zen-img-multi-selected').forEach(img => {
            img.classList.remove('zen-img-multi-selected');
            if (img.classList.length === 0) img.removeAttribute('class');
        });
        return clone.innerHTML;
    }

    function getPrintHtml() {
        if (!_activeQuill || !_activeQuill.root) return '';
        if (!getPlainText() && !hasMediaOrEmbeds()) return '';
        const clone = _activeQuill.root.cloneNode(true);
        clone.querySelectorAll('img.zen-img-multi-selected').forEach(img => {
            img.classList.remove('zen-img-multi-selected');
            if (img.classList.length === 0) img.removeAttribute('class');
        });
        clone.querySelectorAll('select.ql-ui').forEach(el => el.remove());
        return '<div class="ql-editor little-note-view">' + clone.innerHTML + '</div>';
    }

    function insertSpecialChar(ch) {
        if (!ch || !_activeQuill) return false;
        const Quill = global.Quill;
        _activeQuill.focus();
        let index = 0;
        if (_savedSpecialCharRange && typeof _savedSpecialCharRange.index === 'number') {
            index = _savedSpecialCharRange.index;
        } else {
            const curSel = _activeQuill.getSelection();
            index = curSel ? curSel.index : Math.max(0, _activeQuill.getLength() - 1);
        }
        _activeQuill.insertText(index, ch, Quill.sources.USER);
        _savedSpecialCharRange = { index: index + ch.length, length: 0 };
        _activeQuill.setSelection(_savedSpecialCharRange.index, 0, Quill.sources.SILENT);
        return true;
    }

    function applyLinkFromModal({ url, text, remove } = {}) {
        if (!_activeQuill) return;
        const Quill = global.Quill;
        const state = _pendingLinkState;
        _pendingLinkState = null;
        _activeQuill.focus();
        if (!state) return;

        if (remove) {
            _activeQuill.setSelection(state.range.index, state.range.length, Quill.sources.SILENT);
            _activeQuill.format('link', false, Quill.sources.USER);
            return;
        }
        const cleanUrl = normalizeLinkInput(url || '');
        if (!cleanUrl) return;

        if (state.isEdit && state.range.length > 0) {
            const existingText = _activeQuill.getText(state.range.index, state.range.length);
            const nextLabel = (text && text.trim()) ? text.trim() : existingText;
            if (nextLabel !== existingText) {
                _activeQuill.deleteText(state.range.index, state.range.length, Quill.sources.USER);
                _activeQuill.insertText(state.range.index, nextLabel, { link: cleanUrl }, Quill.sources.USER);
                _activeQuill.setSelection(state.range.index + nextLabel.length, 0, Quill.sources.SILENT);
            } else {
                _activeQuill.formatText(state.range.index, state.range.length, 'link', cleanUrl, Quill.sources.USER);
                _activeQuill.setSelection(state.range.index + state.range.length, 0, Quill.sources.SILENT);
            }
            _activeQuill.format('link', false, Quill.sources.SILENT);
            return;
        }

        if (state.hasSelection && state.range.length > 0) {
            _activeQuill.setSelection(state.range.index, state.range.length, Quill.sources.SILENT);
            _activeQuill.format('link', cleanUrl, Quill.sources.USER);
            _activeQuill.setSelection(state.range.index + state.range.length, 0, Quill.sources.SILENT);
            _activeQuill.format('link', false, Quill.sources.SILENT);
            return;
        }

        const label = (text && text.trim()) ? text.trim() : cleanUrl;
        _activeQuill.insertText(state.range.index, label, 'link', cleanUrl, Quill.sources.USER);
        _activeQuill.insertText(state.range.index + label.length, ' ', { link: false }, Quill.sources.USER);
        _activeQuill.setSelection(state.range.index + label.length + 1, 0, Quill.sources.SILENT);
        _activeQuill.format('link', false, Quill.sources.SILENT);
    }

    function cancelLinkFromModal() {
        const state = _pendingLinkState;
        _pendingLinkState = null;
        if (_activeQuill) {
            _activeQuill.focus();
            if (state && state.range) _activeQuill.setSelection(state.range.index, state.range.length);
        }
    }

    function handleEscape() {
        if (_isLightboxOpenFn && _isLightboxOpenFn()) {
            _closeLightboxFn();
            return true;
        }
        const mdHelp = document.getElementById('markdownHelpModal');
        if (mdHelp && mdHelp.open) {
            closeMarkdownHelpModal();
            return true;
        }
        const imgMenu = _activeOverlayHost ? _activeOverlayHost.querySelector('#image-context-menu') : document.getElementById('image-context-menu');
        if (imgMenu && imgMenu.style.display === 'block') {
            if (_hideImageMenuFn) _hideImageMenuFn();
            return true;
        }
        const tblMenu = _activeOverlayHost ? _activeOverlayHost.querySelector('#table-context-menu') : document.getElementById('table-context-menu');
        if (tblMenu && tblMenu.style.display === 'block') {
            if (_hideTableMenuFn) _hideTableMenuFn();
            return true;
        }
        if (_hasImageSelectionFn && _hasImageSelectionFn()) {
            if (_hideResizerFn) _hideResizerFn();
            return true;
        }
        return false;
    }

    global.LittleNoteEditor = {
        mount,
        unmount,
        handleEscape,
        getActiveQuill: () => _activeQuill,
        getHtml,
        getPrintHtml,
        getPlainText,
        hasMediaOrEmbeds,
        setEnabled: (enabled) => { if (_activeQuill) _activeQuill.enable(Boolean(enabled)); },
        focus: () => { if (_activeQuill) _activeQuill.focus(); },
        insertSpecialChar,
        captureSelectionRange: () => { if (_activeQuill) _savedSpecialCharRange = _activeQuill.getSelection(); },
        applyLinkFromModal,
        cancelLinkFromModal,
        openMarkdownHelpModal,
        closeMarkdownHelpModal,
        isQuillHtml,
        legacyMarkdownToQuillHtml,
        stripHtmlToPlainText,
        normalizeLinkInput,
        isLocalFileOrFolderPath
    };
})(window);
