(function () {
    'use strict';

    // BEGIN PURE
    var imageBase = '';
    function setImageBase(v) { imageBase = v || ''; }

    function esc(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // "text|200" in the alt text means a 200px wide image
    function splitAlt(alt) {
        var m = /^(.*?)\|(\d{1,4})$/.exec(alt);
        if (m) {
            var w = parseInt(m[2], 10);
            if (w >= 16 && w <= 4000) { return { alt: m[1], width: w }; }
        }
        return { alt: alt, width: 0 };
    }

    function inline(raw, lineNo) {
        var stash = [];
        var imageCount = 0;
        function keep(html) {
            stash.push(html);
            return '\u0000' + (stash.length - 1) + '\u0000';
        }
        var out = esc(raw);
        out = out.replace(/`([^`]+)`/g, function (m, c) {
            return keep('<code>' + c + '</code>');
        });
        // Images: ![text](source) or ![text|width](source). Text is already escaped above.
        out = out.replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+|data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+\/=]+|img:[A-Za-z0-9._-]+)\)/g, function (m, rawAlt, src) {
            var url = src;
            if (src.indexOf('img:') === 0) {
                if (!imageBase) { return m; }
                url = esc(imageBase) + '/' + src.slice(4);
            }
            var a = splitAlt(rawAlt);
            var html = '<img src="' + url + '" alt="' + a.alt + '"';
            if (a.width) { html += ' width="' + a.width + '"'; }
            if (lineNo !== undefined) { html += ' data-line="' + lineNo + '" data-idx="' + imageCount + '"'; }
            imageCount++;
            return keep(html + ' loading="lazy">');
        });
        out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
        out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
        out = out.replace(/\u0000(\d+)\u0000/g, function (m, i) {
            return stash[Number(i)];
        });
        return out;
    }

    // Rewrites the width of the idx-th image on a line of text. width 0 removes it.
    function setImageWidthInLine(line, idx, width) {
        var masked = line.replace(/`[^`]*`/g, function (m) { return new Array(m.length + 1).join('x'); });
        var re = /!\[([^\]]*)\]\((https:\/\/[^\s)]+|data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+\/=]+|img:[A-Za-z0-9._-]+)\)/g;
        var m;
        var k = 0;
        while ((m = re.exec(masked))) {
            if (k === idx) {
                var altStart = m.index + 2;
                var alt = line.slice(altStart, altStart + m[1].length).replace(/\|\d{1,4}$/, '');
                var src = line.slice(altStart + m[1].length + 2, m.index + m[0].length - 1);
                return line.slice(0, m.index) + '![' + alt + (width ? '|' + width : '') + '](' + src + ')' +
                    line.slice(m.index + m[0].length);
            }
            k++;
        }
        return line;
    }

    function legacyAutoFenceBody(content) {
        var match = /^```[a-z0-9_+-]*\r?\n([\s\S]*?)\r?\n```$/i.exec(content.trim());
        return match && /(^|\n)[ \t]*!\[[^\]]*\]\(img:[A-Za-z0-9._-]+\)[ \t]*(?=\n|$)/.test(match[1]) ? match[1] : null;
    }

    function detectCodeLanguage(source) {
        if (!source) { return null; }
        var clean = source.trim();
        if (clean.length < 8 || /^(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s)/m.test(clean)) { return null; }
        var lines = clean.split(/\r?\n/).filter(function (line) { return line.trim(); });
        var hasProseLine = lines.some(function (line) {
            var trimmed = line.trim();
            return /^[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)+[.!?]?$/i.test(trimmed) &&
                !/^(?:return|throw|break|continue|await|yield|from|import|export|extends|implements|interface|type|class|function|async|const|let|var|def|fn|pub|struct|package|func|val|using)\b/i.test(trimmed);
        });
        if (hasProseLine) { return null; }

        var hasJavaScript = /(^|\n)\s*(?:import|export)\s|(^|\n)\s*(?:function|const|let|var|class\s+\w+)\b|=>|\bconsole\./.test(clean);
        var hasJsx = /<\/?[A-Za-z][\w.-]*(?:\s[^<>]*?)?\/?\s*>/.test(clean);
        var hasHtmlMarkup = /<!doctype html\b|<\/?(?:html|head|body|div|span|p|h[1-6]|main|section|article|a|ul|ol|li|table|header|footer|form|input|button|script|style|nav|meta|link)\b/i.test(clean);
        var language = '';
        var configPairs = lines.filter(function (line) { return /^\s*[\w.-]+:\s*(?:\S|$)/.test(line); }).length;
        var yamlListItems = lines.filter(function (line) { return /^\s*-\s+\S/.test(line); }).length;
        var isJson = /^[\[{]/.test(clean);
        if (isJson) {
            try { JSON.parse(clean); language = 'json'; } catch (err) { }
        }

        if (!language && hasJsx && hasJavaScript) {
            language = /:\s*(?:string|number|boolean|[A-Z]\w*)\b|\binterface\s+\w+/.test(clean) ? 'tsx' : 'jsx';
        } else if (!language && hasHtmlMarkup && !hasJavaScript) {
            language = 'html';
        } else if (!language && configPairs + yamlListItems >= 2 && !/[{};]/.test(clean) && !hasJavaScript) {
            language = 'yaml';
        } else if (!language && /<\?php\b/i.test(clean)) {
            language = 'php';
        } else if (!language && /\b(?:using\s+System|Console\.WriteLine|namespace\s+\w+)\b/.test(clean)) {
            language = 'csharp';
        } else if (!language && /#include\s*<|\bstd::|\bint\s+main\s*\(/.test(clean)) {
            language = /\bstd::|#include\s*<(?:iostream|string|vector|memory|map|set|algorithm|utility|functional|unordered_map|unordered_set)\b/.test(clean) ? 'cpp' : 'c';
        } else if (!language && /\bpackage\s+main\b|\bfunc\s+main\s*\(/.test(clean)) {
            language = 'go';
        } else if (!language && /\bfn\s+main\s*\(|\blet\s+mut\s+\w+/.test(clean)) {
            language = 'rust';
        } else if (!language && /\bfun\s+main\s*\(|\bval\s+\w+\s*=/.test(clean)) {
            language = 'kotlin';
        } else if (!language && /\bpublic\s+class\s+\w+|\bstatic\s+void\s+main\s*\(/.test(clean)) {
            language = 'java';
        } else if (!language && /\bfunc\s+\w+\s*\(|\bimport\s+Foundation\b/.test(clean)) {
            language = 'swift';
        } else if (!language && /\bdef\s+\w+\s*\(|\bclass\s+\w+\s*:\s*$|\bprint\s*\(/m.test(clean)) {
            language = 'python';
        } else if (!language && /^\s*def\b/m.test(clean) && /^\s*end\b/m.test(clean)) {
            language = 'ruby';
        } else if (!language && /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(clean) && /\b(?:FROM|VALUES|WHERE|JOIN)\b/i.test(clean)) {
            language = 'sql';
        } else if (!language && /(^|\n)\s*#!.*\b(?:sh|bash)\b|\b(?:echo\s+\S|for\s+\w+\s+in\b.*;\s*do)\b/.test(clean)) {
            language = 'bash';
        } else if (!language && /(^|\n)\s*(?:FROM\s+\S+|RUN\s+\S+|COPY\s+\S+)/.test(clean)) {
            language = 'dockerfile';
        } else if (!language && /(^|\n)\s*[.#*]?[\w-]+(?:\s*,\s*[.#\w-]+)?\s*\{[^}]*\b[a-z-]+\s*:[^}]+\}/is.test(clean)) {
            language = 'css';
        } else if (!language && hasJavaScript) {
            language = /\b(?:interface|enum|implements)\s+\w+|:\s*(?:string|number|boolean)\b/.test(clean) ? 'typescript' : 'javascript';
        }

        if (!language && lines.length >= 2 && (/[{};=<>()[\]]/.test(clean) || configPairs + yamlListItems >= 2)) {
            var guess = window.hljs.highlightAuto(clean);
            if (guess.language && guess.relevance >= 2) { language = guess.language; }
        }
        if (!language || !window.hljs.getLanguage(language)) { return null; }
        return language;
    }

    function areCompatibleLanguages(lang1, lang2) {
        if (!lang1 || !lang2) { return false; }
        if (lang1 === lang2) { return true; }
        var jsFamily = { javascript: true, typescript: true, jsx: true, tsx: true };
        if (jsFamily[lang1] && jsFamily[lang2]) { return true; }
        var cFamily = { c: true, cpp: true };
        if (cFamily[lang1] && cFamily[lang2]) { return true; }
        return false;
    }

    function isSnippetBoundary(prevChunk, nextChunk, separator) {
        if (!prevChunk || !nextChunk) { return false; }

        // 1. Two or more blank lines (3+ newlines) indicates an explicit separation between snippets
        if (separator && /(\r?\n[ \t]*){2,}\r?\n/.test(separator)) {
            return true;
        }

        var nextTrimmed = nextChunk.trim();
        var prevTrimmed = prevChunk.trim();

        // 2. An import or module header starting after code that already has statements or functions
        var isHeader = /^\s*(?:import\s+(?:\{|\*|[A-Za-z0-9_$]+|["'][^"']+)|from\s+[A-Za-z0-9_.]+\s+import|#include\s*<|package\s+[A-Za-z0-9_]+|<!DOCTYPE\b|<\?php\b|using\s+[A-Z]|namespace\s+\w+)/i;
        var prevHasStatements = /(?:^|\n)\s*(?:const|let|var|function|class|def|fn|public|return|if|for|while|[A-Za-z0-9_$]+\s*\([^)]*\)\s*[{;=])|[\}\);]\s*$/m;
        if (isHeader.test(nextTrimmed) && prevHasStatements.test(prevTrimmed)) {
            return true;
        }

        // 3. Different detected programming languages
        var prevLang = detectCodeLanguage(prevTrimmed);
        var nextLang = detectCodeLanguage(nextTrimmed);
        if (prevLang && nextLang && !areCompatibleLanguages(prevLang, nextLang)) {
            return true;
        }

        return false;
    }

    function autoFenceCode(content) {
        if (!window.hljs || typeof window.hljs.highlightAuto !== 'function') { return null; }
        var legacyBody = legacyAutoFenceBody(content);
        var source = legacyBody === null ? content.trim() : legacyBody;
        if (legacyBody === null && /(^|\n)\s*```/.test(source)) {
            var parts = source.split(/(\r?\n)/);
            var output = '';
            var outsideFence = '';
            var inFence = false;
            var changedFence = false;
            function flushOutsideFence() {
                if (!outsideFence) { return; }
                var leading = /^\s*/.exec(outsideFence)[0];
                var trailing = /\s*$/.exec(outsideFence)[0];
                var body = outsideFence.slice(leading.length, outsideFence.length - trailing.length);
                var fenced = body ? autoFenceCode(body) : null;
                if (fenced) {
                    output += leading + fenced + trailing;
                    changedFence = true;
                } else {
                    output += outsideFence;
                }
                outsideFence = '';
            }
            for (var partIndex = 0; partIndex < parts.length; partIndex += 2) {
                var line = parts[partIndex];
                var newline = parts[partIndex + 1] || '';
                if (!inFence && /^```/.test(line)) {
                    flushOutsideFence();
                    output += line + newline;
                    inFence = true;
                } else if (inFence) {
                    output += line + newline;
                    if (/^```[ \t]*$/.test(line)) { inFence = false; }
                } else {
                    outsideFence += line + newline;
                }
            }
            flushOutsideFence();
            return changedFence ? output : null;
        }

        var imageParts = source.split(/(^[ \t]*!\[[^\]]*\]\([^\n]*\)[ \t]*$)/m);
        if (imageParts.length > 1) {
            var changed = false;
            var output = imageParts.map(function (part, index) {
                if (index % 2 === 1) { return part; }
                var leading = /^\s*/.exec(part)[0];
                var trailing = /\s*$/.exec(part)[0];
                var body = part.slice(leading.length, part.length - trailing.length);
                var fenced = body ? autoFenceCode(body) : null;
                if (fenced) {
                    changed = true;
                    return leading + fenced + trailing;
                }
                return part;
            }).join('');
            return changed ? output : null;
        }

        var paragraphs = source.split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/);
        if (paragraphs.length === 1) {
            var singleLang = detectCodeLanguage(source);
            if (singleLang) {
                return '```' + singleLang + '\n' + source + '\n```';
            }
            return null;
        }

        // 1. If there are no snippet boundaries and the entire text is one code sample, wrap it once
        var hasBoundary = false;
        for (var p = 0; p + 2 < paragraphs.length; p += 2) {
            if (isSnippetBoundary(paragraphs[p], paragraphs[p + 2], paragraphs[p + 1])) {
                hasBoundary = true;
                break;
            }
        }
        if (!hasBoundary) {
            var wholeLanguage = detectCodeLanguage(source);
            if (wholeLanguage) {
                return '```' + wholeLanguage + '\n' + source + '\n```';
            }
        }

        // 2. Multiple snippets or mixed content: group contiguous code up to snippet boundaries
        var changedParagraph = false;
        var formattedParts = [];
        var i = 0;
        while (i < paragraphs.length) {
            var part = paragraphs[i];
            var sep = paragraphs[i + 1] || '';
            var lang = detectCodeLanguage(part);
            if (lang) {
                var codeBuffer = [part.trim()];
                var nextSep = sep;
                while (i + 2 < paragraphs.length) {
                    var nextPart = paragraphs[i + 2];
                    var betweenSep = nextSep;
                    if (isSnippetBoundary(codeBuffer.join('\n\n'), nextPart, betweenSep)) {
                        break;
                    }
                    var combinedCandidate = codeBuffer.join('\n\n') + '\n\n' + nextPart.trim();
                    var nextLang = detectCodeLanguage(combinedCandidate);
                    if (nextLang && (areCompatibleLanguages(lang, nextLang) || nextLang === lang)) {
                        lang = nextLang;
                        codeBuffer.push(nextPart.trim());
                        i += 2;
                        nextSep = paragraphs[i + 1] || '';
                    } else {
                        break;
                    }
                }
                formattedParts.push('```' + lang + '\n' + codeBuffer.join('\n\n') + '\n```');
                changedParagraph = true;
                if (nextSep) { formattedParts.push(nextSep); }
                i += 2;
            } else {
                formattedParts.push(part);
                if (sep) { formattedParts.push(sep); }
                i += 2;
            }
        }
        if (changedParagraph) {
            return formattedParts.join('');
        }

        return null;
    }

    function buildPreviewLineMap(source, preview) {
        var sourceLines = source.split('\n');
        var previewLines = preview.split('\n');
        var sourceIndex = 0;
        return previewLines.map(function (line) {
            if (/^```[a-z0-9_+-]*$/i.test(line)) { return null; }
            var matchIndex = sourceLines.indexOf(line, sourceIndex);
            if (matchIndex < 0) { return null; }
            sourceIndex = matchIndex + 1;
            return matchIndex;
        });
    }

    function splitTableRow(line) {
        var cells = [];
        var cell = '';
        var inCode = false;
        var value = line.trim();
        for (var i = 0; i < value.length; i++) {
            var character = value.charAt(i);
            if (character === '\\' && value.charAt(i + 1) === '|') {
                cell += '|';
                i++;
            } else if (character === '`') {
                inCode = !inCode;
                cell += character;
            } else if (character === '|' && !inCode) {
                cells.push(cell.trim());
                cell = '';
            } else {
                cell += character;
            }
        }
        cells.push(cell.trim());
        if (value.charAt(0) === '|') { cells.shift(); }
        if (value.charAt(value.length - 1) === '|') { cells.pop(); }
        return cells;
    }

    function tableAlignments(line) {
        if (line.indexOf('|') === -1) { return null; }
        var cells = splitTableRow(line);
        if (!cells.length || !cells.every(function (cell) { return /^:?-{3,}:?$/.test(cell); })) { return null; }
        return cells.map(function (cell) {
            var left = cell.charAt(0) === ':';
            var right = cell.charAt(cell.length - 1) === ':';
            return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
        });
    }

    function codeCopyButton() {
        return '<button class="code-copy-button" type="button" title="Copy code" aria-label="Copy code"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>';
    }

    function codeBlockHtml(codeHtml) {
        return '<div class="code-block">' + codeCopyButton() + '<pre>' + codeHtml + '</pre></div>';
    }

    function renderMarkdown(text, sourceLineMap) {
        var normalizedText = text;
        if (!/```/.test(normalizedText)) {
            var inferredFence = autoFenceCode(normalizedText);
            if (inferredFence) { normalizedText = inferredFence; }
        }
        if (window.marked && typeof window.marked.parse === 'function') {
            var renderer = new window.marked.Renderer();
            var imageSourceOffset = 0;
            var imageCountsByLine = {};
            renderer.code = function (token) {
                var code = token && typeof token.text === 'string' ? token.text : '';
                var language = token && typeof token.lang === 'string' ? token.lang.trim().split(/\s+/)[0] : '';
                var className = language ? ' language-' + language.replace(/[^a-z0-9_+-]/gi, '') : '';
                var rendered = code;
                if (window.hljs) {
                    if (language && window.hljs.getLanguage(language)) {
                        rendered = window.hljs.highlight(code, { language: language }).value;
                    } else {
                        rendered = window.hljs.highlightAuto(code).value;
                    }
                } else {
                    rendered = esc(code);
                }
                return codeBlockHtml('<code class="' + className.replace(/^\s+/, '') + '">' + rendered + '</code>') + '\n';
            };
            renderer.image = function (token) {
                var href = token && typeof token.href === 'string' ? token.href : '';
                var title = token && typeof token.title === 'string' ? token.title : '';
                var text = token && typeof token.text === 'string' ? token.text : '';
                var url = href;
                var altText = text;
                var width = 0;
                if (url.indexOf('img:') === 0) {
                    if (!imageBase) { return '<span class="markdown-image-placeholder">' + esc(text || '') + '</span>'; }
                    url = esc(imageBase) + '/' + url.slice(4);
                }
                var match = /^(.*)\|(\d{1,4})$/.exec(altText);
                if (match) {
                    width = parseInt(match[2], 10);
                    if (width >= 16 && width <= 4000) { altText = match[1]; }
                }
                var output = '<img src="' + esc(url) + '" alt="' + esc(altText) + '" loading="lazy"';
                if (width) { output += ' width="' + width + '"'; }
                if (title) { output += ' title="' + esc(title) + '"'; }
                var rawImage = token && typeof token.raw === 'string' ? token.raw : '';
                var imagePosition = rawImage ? normalizedText.indexOf(rawImage, imageSourceOffset) : -1;
                if (imagePosition !== -1) {
                    imageSourceOffset = imagePosition + rawImage.length;
                    var imageLine = normalizedText.slice(0, imagePosition).split('\n').length - 1;
                    var sourceLine = sourceLineMap && sourceLineMap[imageLine] !== null && sourceLineMap[imageLine] !== undefined
                        ? sourceLineMap[imageLine]
                        : imageLine;
                    var imageIndex = imageCountsByLine[imageLine] || 0;
                    imageCountsByLine[imageLine] = imageIndex + 1;
                    output += ' data-line="' + sourceLine + '" data-idx="' + imageIndex + '"';
                }
                output += '>';
                return output;
            };
            var parsed = window.marked.parse(normalizedText, {
                gfm: true,
                breaks: true,
                headerIds: false,
                mangle: false,
                renderer: renderer
            });
            if (typeof parsed === 'string' && parsed.trim()) {
                return parsed;
            }
        }

        var lines = text.split('\n');
        var html = [];
        var list = null;
        var inCode = false;
        var codeBuf = [];
        var codeLanguage = '';

        function closeList() {
            if (list) { html.push('</' + list + '>'); list = null; }
        }
        function openList(type) {
            if (list !== type) { closeList(); html.push('<' + type + '>'); list = type; }
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var sourceLine = sourceLineMap && sourceLineMap[i] !== null && sourceLineMap[i] !== undefined
                ? sourceLineMap[i]
                : i;
            var m;

            if (/^```/.test(line) && (!inCode || /^```[ \t]*$/.test(line))) {
                if (inCode) {
                    var languageClass = codeLanguage ? ' class="language-' + codeLanguage + '"' : '';
                    html.push(codeBlockHtml('<code' + languageClass + '>' + esc(codeBuf.join('\n')) + '</code>'));
                    codeBuf = [];
                    inCode = false;
                    codeLanguage = '';
                } else {
                    closeList();
                    inCode = true;
                    var candidateLanguage = line.slice(3).trim().split(/\s+/)[0].toLowerCase();
                    codeLanguage = /^[a-z0-9_+-]+$/.test(candidateLanguage) ? candidateLanguage : '';
                }
                continue;
            }
            if (inCode) { codeBuf.push(line); continue; }

            var alignments = i + 1 < lines.length ? tableAlignments(lines[i + 1]) : null;
            if (alignments) {
                closeList();
                var headers = splitTableRow(line);
                html.push('<table><thead><tr>');
                headers.forEach(function (cell, column) {
                    var alignment = alignments[column] ? ' style="text-align:' + alignments[column] + '"' : '';
                    html.push('<th' + alignment + '>' + inline(cell) + '</th>');
                });
                html.push('</tr></thead>');
                i += 2;
                if (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') !== -1) {
                    html.push('<tbody>');
                    while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') !== -1) {
                        var row = splitTableRow(lines[i]);
                        html.push('<tr>');
                        for (var column = 0; column < headers.length; column++) {
                            var alignment = alignments[column] ? ' style="text-align:' + alignments[column] + '"' : '';
                            html.push('<td' + alignment + '>' + inline(row[column] || '') + '</td>');
                        }
                        html.push('</tr>');
                        i++;
                    }
                    html.push('</tbody>');
                }
                i--;
                html.push('</table>');
                continue;
            }

            if ((m = /^\s*[-*+] \[([ xX])\] ?(.*)$/.exec(line))) {
                openList('ul');
                var done = m[1] !== ' ';
                html.push('<li class="task' + (done ? ' done' : '') + '"><input type="checkbox" data-line="' + sourceLine + '"' +
                    (done ? ' checked' : '') + '><span>' + inline(m[2], sourceLine) + '</span></li>');
                continue;
            }
            if ((m = /^\s*[-*+] (.*)$/.exec(line))) {
                openList('ul');
                html.push('<li>' + inline(m[1], sourceLine) + '</li>');
                continue;
            }
            if ((m = /^\s*\d+[.)] (.*)$/.exec(line))) {
                openList('ol');
                html.push('<li>' + inline(m[1], sourceLine) + '</li>');
                continue;
            }

            closeList();

            if (line.trim() === '') {
                html.push('<p class="preview-blank-line"><br></p>');
                continue;
            }
            if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
                html.push('<h' + m[1].length + '>' + inline(m[2], sourceLine) + '</h' + m[1].length + '>');
            } else if ((m = /^>\s?(.*)$/.exec(line))) {
                html.push('<blockquote>' + inline(m[1], sourceLine) + '</blockquote>');
            } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
                html.push('<hr>');
            } else {
                html.push('<p>' + inline(line, sourceLine) + '</p>');
            }
        }

        if (inCode) {
            var finalLanguageClass = codeLanguage ? ' class="language-' + codeLanguage + '"' : '';
            html.push(codeBlockHtml('<code' + finalLanguageClass + '>' + esc(codeBuf.join('\n')) + '</code>'));
        }
        closeList();
        return html.join('');
    }

    function taskStats(text) {
        var total = 0;
        var done = 0;
        var re = /^\s*[-*+] \[([ xX])\]/gm;
        var m;
        while ((m = re.exec(text))) {
            total++;
            if (m[1] !== ' ') { done++; }
        }
        return { total: total, done: done };
    }

    function formatAgo(ts, now) {
        var s = Math.max(0, Math.round((now - ts) / 1000));
        if (s < 45) { return 'just now'; }
        var m = Math.round(s / 60);
        if (m < 60) { return m + 'm ago'; }
        var h = Math.round(m / 60);
        if (h < 24) { return h + 'h ago'; }
        var d = Math.round(h / 24);
        if (d < 30) { return d + 'd ago'; }
        return new Date(ts).toLocaleDateString();
    }
    // END PURE

    if (typeof acquireVsCodeApi !== 'function') { return; }
    var vscode = acquireVsCodeApi();
    var appScript = document.currentScript;
    var markdownRuntimeSrc = appScript && appScript.getAttribute('data-markdown-src');
    var markdownRuntimeNonce = appScript && appScript.nonce;
    var markdownRuntimePromise = null;

    function loadMarkdownRuntime() {
        if (window.marked && window.hljs) { return null; }
        if (!markdownRuntimeSrc) { return Promise.resolve(false); }
        if (markdownRuntimePromise) { return markdownRuntimePromise; }

        markdownRuntimePromise = new Promise(function (resolve) {
            var script = document.createElement('script');
            script.src = markdownRuntimeSrc;
            script.nonce = markdownRuntimeNonce;
            script.onload = function () { resolve(!!(window.marked && window.hljs)); };
            script.onerror = function () {
                markdownRuntimePromise = null;
                resolve(false);
            };
            document.head.appendChild(script);
        });
        return markdownRuntimePromise;
    }

    var COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    var EMOJI = { red: '\uD83D\uDD34', orange: '\uD83D\uDFE0', yellow: '\uD83D\uDFE1', green: '\uD83D\uDFE2', blue: '\uD83D\uDD35', purple: '\uD83D\uDFE3' };

    var settings = { autoSaveDelay: 400, fontSize: 13, newNoteTitle: 'untitled', trashRetentionDays: 30 };
    var pages = [];
    var trash = [];
    var scope = 'global';
    var hasWorkspace = false;
    var currentId = null;
    var untouchedNewNoteId = null;
    var newNoteMenuId = null;

    function notifyCurrentNoteChanged() {
        window.dispatchEvent(new Event('notes-current-change'));
    }

    var previewMode = false;
    var pendingSave = false;
    var saveTimeout = null;
    var footerStatusTimeout = null;
    var footerSaveStatus = null;
    var footerActivityStatus = null;
    var footerActivityTimeout = null;
    var flashTimeout = null;
    var previewClickTimeout = null;
    var flashActive = false;
    var lastDeleted = null;
    var panelMode = null;
    var activeResult = 0;
    var visibleResults = [];
    var menuOpen = false;
    var menuLayout = 'auto';
    var newNoteMenuLayout = 'labels';
    var lastInvokedMenuActionId = null;
    var toolbarPinned = ['addBtn', 'previewBtn'];
    var menuToolbarActions = Object.create(null);
    var selectedImage = null;
    var pendingImageCut = null;
    var imageCutRequestId = 0;
    var confirmTimers = new WeakMap();

    function $(id) { return document.getElementById(id); }

    var el = {
        titleRow: document.querySelector('.title-row'),
        toolbarContextMenu: $('toolbarContextMenu'),
        pinnedMenuActions: $('pinnedMenuActions'),
        noteSelect: $('noteSelect'),
        noteSelectBtn: $('noteSelectBtn'),
        notePicker: $('notePicker'),
        notePickerSearch: $('notePickerSearch'),
        notePickerClose: $('notePickerClose'),
        notePickerList: $('notePickerList'),
        searchBtn: $('searchBtn'),
        addBtn: $('addBtn'),
        terminalBtn: $('terminalBtn'),
        zoomOutBtn: $('zoomOutBtn'),
        zoomInBtn: $('zoomInBtn'),
        panel: $('panel'),
        panelInput: $('panelInput'),
        panelClear: $('panelClear'),
        panelTitle: $('panelTitle'),
        panelAction: $('panelAction'),
        panelClose: $('panelClose'),
        panelList: $('panelList'),
        titleInput: $('titleInput'),
        pinBtn: $('pinBtn'),
        previewBtn: $('previewBtn'),
        menuBtn: $('menuBtn'),
        menu: $('menu'),
        linkRow: $('linkRow'),
        noteInput: $('noteInput'),
        preview: $('preview'),
        statusText: $('statusText'),
        undoBtn: $('undoBtn'),
        edited: $('edited'),
        footerMeta: $('footerMeta'),
        scopeChip: $('scopeChip'),
        tasks: $('tasks'),
        progressTrack: $('progressTrack'),
        progressBar: $('progressBar'),
        backgroundStatus: $('backgroundStatus'),
        imgBar: $('imgBar'),
        imgHandle: $('imgHandle')
    };

    function setBackgroundStatus(text, isError) {
        el.backgroundStatus.textContent = text;
        el.backgroundStatus.classList.toggle('is-error', !!isError);
        el.backgroundStatus.hidden = !text;
        setFooterActivityStatus(text);
    }

    function clearCopyHighlight() {
        [menuToolbarActions['menu:copy-note'] && menuToolbarActions['menu:copy-note'].button]
            .concat(Array.prototype.slice.call(el.pinnedMenuActions.querySelectorAll('[data-toolbar-pin-id="menu:copy-note"]')))
            .filter(Boolean)
            .forEach(function (button) { button.classList.remove('copy-confirmed'); });
    }

    document.addEventListener('click', function (event) {
        var button = event.target.closest && event.target.closest('button');
        if (button && !button.matches('[data-toolbar-action="menu:copy-note"], [data-toolbar-pin-id="menu:copy-note"]')) {
            clearCopyHighlight();
        }
    }, true);

    function isCompactToolbar() {
        return el.titleInput.parentElement.clientWidth <= 520;
    }

    function animateTitleOnOpen() {
        if (document.hidden || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) { return; }
        el.titleInput.classList.remove('title-open-animation');
        void el.titleInput.offsetWidth;
        el.titleInput.classList.add('title-open-animation');
    }

    /* ---------- Model helpers ---------- */

    function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

    function defaultTitle() {
        if (settings.newNoteTitle === 'date') {
            return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        }
        return 'Untitled';
    }

    function makeNote(title) {
        return { id: uid(), title: title || defaultTitle(), content: '', updated: Date.now() };
    }

    function isBlankNote(n) {
        return !n.content.trim() && (!n.title || n.title === 'Untitled' || n.title === defaultTitle());
    }

    function currentIndex() {
        for (var i = 0; i < pages.length; i++) {
            if (pages[i].id === currentId) { return i; }
        }
        return -1;
    }

    function currentNote() {
        var i = currentIndex();
        return i >= 0 ? pages[i] : null;
    }

    function noteLinks(note) {
        if (!note) { return []; }
        var links = Array.isArray(note.links) ? note.links.slice() : [];
        if (note.link && !links.some(function (link) {
            return link.path === note.link.path && link.line === note.link.line;
        })) {
            links.unshift(note.link);
        }
        return links;
    }

    function setNoteLinks(note, links) {
        if (!links.length) {
            delete note.links;
            delete note.link;
            return;
        }
        note.links = links;
        note.link = links[0];
    }

    function addNoteLink(note, link) {
        if (!note || !link) { return; }
        var links = noteLinks(note);
        if (links.some(function (item) { return item.path === link.path && item.line === link.line; })) { return; }
        setNoteLinks(note, links.concat([link]));
    }

    function ensureCurrent() {
        if (!pages.length) { pages.push(makeNote()); }
        if (currentIndex() < 0) { currentId = pages[0].id; }
    }

    function keepPinnedFirst() {
        pages = pages.filter(function (p) { return p.pinned; }).concat(pages.filter(function (p) { return !p.pinned; }));
    }

    function noteTitleText(n, maxTitleLength) {
        var t = taskStats(n.content);
        var title = n.title || 'Untitled';
        if (maxTitleLength && title.length > maxTitleLength) {
            title = title.slice(0, maxTitleLength - 1) + '\u2026';
        }
        return title + (t.total ? ' (' + t.done + '/' + t.total + ')' : '');
    }

    function noteTitle(n, i, maxTitleLength) {
        return (i + 1) + '. ' + noteTitleText(n, maxTitleLength);
    }

    function noteLabel(n, i, maxTitleLength) {
        return (n.pinned ? '\u2605 ' : '') + (n.color ? EMOJI[n.color] + ' ' : '') +
            noteTitle(n, i, maxTitleLength);
    }

    /* ---------- Saving ---------- */

    function updateSaveStatus(status) {
        clearTimeout(footerStatusTimeout);
        footerSaveStatus = status;
        el.statusText.textContent = status;
        renderFooter();
        if (status === 'Saved') {
            footerStatusTimeout = setTimeout(function () {
                if (footerSaveStatus === 'Saved' && !pendingSave) {
                    footerSaveStatus = null;
                    renderFooter();
                }
            }, 1500);
        }
    }

    function setFooterActivityStatus(status, duration) {
        clearTimeout(footerActivityTimeout);
        footerActivityTimeout = null;
        if (!status) {
            footerActivityStatus = null;
            renderFooter();
            return;
        }
        footerActivityStatus = status;
        el.statusText.textContent = status;
        renderFooter();
        if (typeof duration === 'number') {
            footerActivityTimeout = setTimeout(function () {
                footerActivityStatus = null;
                footerActivityTimeout = null;
                renderFooter();
            }, Math.max(500, Math.min(duration, 10000)));
        }
    }

    function persist() {
        clearTimeout(saveTimeout);
        pendingSave = false;
        vscode.postMessage({ type: 'save', pages: pages, trash: trash });
        updateSaveStatus('Saved');
    }

    function persistIfPending() {
        if (pendingSave) { persist(); }
    }

    function markDirty() {
        pendingSave = true;
        flashActive = false;
        updateSaveStatus('Saving');
        el.undoBtn.hidden = true;
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(persist, settings.autoSaveDelay);
    }

    function flash(text, withUndo) {
        clearTimeout(flashTimeout);
        flashActive = true;
        setFooterActivityStatus(text, withUndo ? 8000 : 2500);
        el.undoBtn.hidden = !withUndo;
        flashTimeout = setTimeout(function () {
            flashActive = false;
            el.undoBtn.hidden = true;
            if (!pendingSave) { updateSaveStatus('Saved'); }
            lastDeleted = null;
        }, withUndo ? 8000 : 2500);
    }

    function saveViewState() {
        vscode.setState({
            currentId: currentId,
            previewMode: previewMode,
            untouchedNewNoteId: untouchedNewNoteId,
            newNoteMenuId: newNoteMenuId,
            menuLayout: menuLayout,
            toolbarPinned: toolbarPinned.slice(),
            toolbarPinsVersion: 2
        });
    }

    function toolbarPinOptions() {
        return [
            { id: 'searchBtn', label: 'Search', button: el.searchBtn },
            { id: 'terminalBtn', label: "Show today's terminal commands", button: el.terminalBtn },
            { id: 'pinBtn', label: 'Pin note action', button: el.pinBtn },
            { id: 'previewBtn', label: 'Markdown preview', button: el.previewBtn }
        ].filter(function (item) { return !!item.button; });
    }

    function applyToolbarPins() {
        el.addBtn.classList.remove('toolbar-pinned', 'toolbar-unpinned');
        toolbarPinOptions().forEach(function (item) {
            var pinned = toolbarPinned.indexOf(item.id) !== -1;
            item.button.classList.toggle('toolbar-pinned', pinned);
            item.button.classList.toggle('toolbar-unpinned', !pinned);
        });
        renderPinnedMenuActions();
        updateToolbarResponsiveVisibility();
    }

    function updateToolbarResponsiveVisibility() {
        var row = el.titleRow;
        var responsiveButtons = Array.prototype.slice.call(el.pinnedMenuActions.querySelectorAll('.icon-btn')).reverse();

        responsiveButtons.forEach(function (button) {
            button.classList.remove('toolbar-responsive-hidden');
        });

        function controlsNeedMoreSpace() {
            var fixedWidth = 0;
            var fixedControlCount = 0;
            Array.prototype.forEach.call(row.children, function (child) {
                if (child === el.titleInput || child.hidden || child.classList.contains('toolbar-responsive-hidden') ||
                    window.getComputedStyle(child).display === 'none') {
                    return;
                }
                fixedWidth += child.getBoundingClientRect().width;
                fixedControlCount++;
            });
            var gap = parseFloat(window.getComputedStyle(row).columnGap) || 0;
            var minTitleWidth = parseFloat(window.getComputedStyle(el.titleInput).minWidth) || 0;
            return fixedWidth + minTitleWidth + gap * fixedControlCount > row.clientWidth + 1;
        }

        for (var i = 0; i < responsiveButtons.length && controlsNeedMoreSpace(); i++) {
            responsiveButtons[i].classList.add('toolbar-responsive-hidden');
        }
    }

    function renderPinnedMenuActions() {
        Array.prototype.forEach.call(el.pinnedMenuActions.querySelectorAll('.pinned-menu-action'), function (button) {
            button.remove();
        });
        var pinOptions = toolbarPinOptions();
        pinOptions.forEach(function (item) {
            item.button.dataset.toolbarPinId = item.id;
        });
        var ids = toolbarPinned.filter(function (id) { return id.indexOf('menu:') === 0; });
        ids.forEach(function (id) {
            var action = menuToolbarActions[id];
            if (!action) { return; }
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'icon-btn pinned-menu-action';
            button.setAttribute('aria-label', action.label);
            button.title = action.label;
            button.innerHTML = action.icon;
            button.dataset.toolbarPinId = id;
            button.addEventListener('click', function () {
                lastInvokedMenuActionId = id;
                action.button.click();
                syncPinnedMenuActionStates();
            });
            button.addEventListener('contextmenu', function (event) {
                event.stopPropagation();
                openToolbarContextMenu(event, id, action.label);
            });
            el.pinnedMenuActions.appendChild(button);
        });
        var children = Array.prototype.slice.call(el.pinnedMenuActions.children);
        children.sort(function (left, right) {
            var leftIndex = toolbarPinned.indexOf(left.dataset.toolbarPinId);
            var rightIndex = toolbarPinned.indexOf(right.dataset.toolbarPinId);
            return (leftIndex === -1 ? Number.MAX_VALUE : leftIndex) -
                (rightIndex === -1 ? Number.MAX_VALUE : rightIndex);
        });
        children.forEach(function (button) { el.pinnedMenuActions.appendChild(button); });
        el.pinnedMenuActions.hidden = !children.some(function (button) {
            return toolbarPinned.indexOf(button.dataset.toolbarPinId) !== -1;
        });
        syncPinnedMenuActionStates();
        updateToolbarResponsiveVisibility();
    }

    function syncPinnedMenuActionStates() {
        Array.prototype.forEach.call(el.pinnedMenuActions.querySelectorAll('.pinned-menu-action'), function (button) {
            var id = button.dataset.toolbarPinId;
            var action = menuToolbarActions[id];
            var stateButton = id === 'pinBtn' ? el.pinBtn
                : id === 'previewBtn' ? el.previewBtn
                    : id === 'searchBtn' ? el.searchBtn
                        : action && action.button;
            var pressed = stateButton && stateButton.getAttribute('aria-pressed');
            if (id.indexOf('menu:') === 0 && window.notesAi &&
                typeof window.notesAi.isToolbarAction === 'function' &&
                window.notesAi.isToolbarAction(id)) {
                pressed = window.notesAi.isToolbarActionActive(id) ? 'true' : 'false';
            } else if (id.indexOf('menu:') === 0 && lastInvokedMenuActionId === id) {
                pressed = 'true';
            }
            if (pressed === null || pressed === undefined) {
                button.removeAttribute('aria-pressed');
            } else {
                button.setAttribute('aria-pressed', pressed);
            }
        });
    }

    window.addEventListener('notes-ai-state-change', syncPinnedMenuActionStates);

    function closeToolbarContextMenu() {
        el.toolbarContextMenu.hidden = true;
    }

    function openToolbarContextMenu(event, onlyId, customLabel) {
        event.preventDefault();
        el.toolbarContextMenu.innerHTML = '';
        var options = customLabel
            ? [{ id: onlyId, label: customLabel }]
            : toolbarPinOptions().filter(function (item) {
                return onlyId ? item.id === onlyId : toolbarPinned.indexOf(item.id) === -1;
            });
        if (!options.length) { closeToolbarContextMenu(); return; }
        el.toolbarContextMenu.setAttribute('aria-label', onlyId ? 'Toolbar icon options' : 'Add toolbar icon');
        options.forEach(function (item) {
            var isPinned = toolbarPinned.indexOf(item.id) !== -1;
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'menu-item';
            button.setAttribute('role', 'menuitemcheckbox');
            button.setAttribute('aria-checked', isPinned ? 'true' : 'false');
            button.textContent = isPinned ? 'Unpin from toolbar' : 'Pin to toolbar';
            button.addEventListener('click', function () {
                toolbarPinned = isPinned
                    ? toolbarPinned.filter(function (id) { return id !== item.id; })
                    : toolbarPinned.concat(item.id);
                applyToolbarPins();
                saveViewState();
                closeToolbarContextMenu();
            });
            el.toolbarContextMenu.appendChild(button);
        });

        el.toolbarContextMenu.hidden = false;
        el.toolbarContextMenu.style.left = event.clientX + 'px';
        el.toolbarContextMenu.style.top = event.clientY + 'px';
        var bounds = el.toolbarContextMenu.getBoundingClientRect();
        el.toolbarContextMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8)) + 'px';
        el.toolbarContextMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8)) + 'px';
        var firstItem = el.toolbarContextMenu.querySelector('button');
        if (firstItem) { firstItem.focus(); }
    }

    function markNoteTouched(id) {
        if (untouchedNewNoteId === id) {
            untouchedNewNoteId = null;
            saveViewState();
        }
    }

    function markCurrentNoteTouched() {
        markNoteTouched(currentId);
    }

    /* ---------- Rendering ---------- */

    function renderOptions() {
        el.noteSelect.innerHTML = '';
        el.notePickerList.innerHTML = '';
        el.notePickerList.classList.toggle('has-markers', pages.some(function (note) {
            return note.pinned || (note.color && COLORS.indexOf(note.color) !== -1);
        }));
        pages.forEach(function (p, idx) {
            var opt = document.createElement('option');
            opt.value = String(idx);
            opt.textContent = noteLabel(p, idx, 35);
            var selected = p.id === currentId;
            if (selected) { opt.selected = true; }
            el.noteSelect.appendChild(opt);

            var row = document.createElement('div');
            row.className = 'note-picker-row';

            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'note-picker-option';
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', selected ? 'true' : 'false');
            item.dataset.index = String(idx);
            item.title = noteLabel(p, idx);
            item.setAttribute('aria-label', noteLabel(p, idx, 35));

            var markerSlot = document.createElement('span');
            markerSlot.className = 'note-picker-marker';
            markerSlot.setAttribute('aria-hidden', 'true');
            var hasColor = p.color && COLORS.indexOf(p.color) !== -1;
            if (hasColor) {
                markerSlot.classList.add('dot-' + p.color);
            }
            if (p.pinned) {
                markerSlot.classList.add('is-pinned');
                markerSlot.textContent = '\u2605';
            } else if (hasColor) {
                var colorDot = document.createElement('span');
                colorDot.className = 'note-picker-marker-dot dot-' + p.color;
                markerSlot.appendChild(colorDot);
            }
            item.appendChild(markerSlot);

            var titleLabel = document.createElement('span');
            titleLabel.className = 'note-picker-title';
            var numberLabel = document.createElement('span');
            numberLabel.className = 'note-picker-number';
            numberLabel.setAttribute('aria-hidden', 'true');
            numberLabel.textContent = String(idx + 1) + '.';
            titleLabel.appendChild(numberLabel);

            var textLabel = document.createElement('span');
            textLabel.className = 'note-picker-title-text';
            textLabel.textContent = noteTitleText(p, 35);
            titleLabel.appendChild(textLabel);
            item.appendChild(titleLabel);

            var actions = document.createElement('button');
            actions.type = 'button';
            actions.className = 'icon-btn note-picker-actions-trigger';
            actions.setAttribute('aria-label', 'Actions for ' + (p.title || 'Untitled'));
            actions.setAttribute('aria-haspopup', 'true');
            actions.setAttribute('aria-expanded', 'false');
            actions.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3.5" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="8" cy="12.5" r="1.2"/></svg>';

            var actionsMenu = document.createElement('div');
            actionsMenu.className = 'note-picker-actions-menu';
            actionsMenu.setAttribute('role', 'group');
            actionsMenu.setAttribute('aria-label', 'Actions for ' + (p.title || 'Untitled'));
            actionsMenu.hidden = true;

            var colorRow = document.createElement('div');
            colorRow.className = 'note-picker-color-row';
            var colorLabel = document.createElement('span');
            colorLabel.textContent = 'Color';
            colorRow.appendChild(colorLabel);

            var swatches = document.createElement('div');
            swatches.className = 'swatches';
            var noColor = document.createElement('button');
            noColor.type = 'button';
            noColor.className = 'swatch none';
            noColor.title = 'No color';
            noColor.setAttribute('aria-label', 'No color');
            noColor.setAttribute('aria-pressed', p.color ? 'false' : 'true');
            noColor.dataset.noteId = p.id;
            noColor.dataset.noteColor = '';
            swatches.appendChild(noColor);

            COLORS.forEach(function (color) {
                var swatch = document.createElement('button');
                swatch.type = 'button';
                swatch.className = 'swatch dot-' + color;
                swatch.title = color.charAt(0).toUpperCase() + color.slice(1);
                swatch.setAttribute('aria-label', color + ' color');
                swatch.setAttribute('aria-pressed', p.color === color ? 'true' : 'false');
                swatch.dataset.noteId = p.id;
                swatch.dataset.noteColor = color;
                swatches.appendChild(swatch);
            });
            colorRow.appendChild(swatches);
            actionsMenu.appendChild(colorRow);

            var deleteRow = document.createElement('div');
            deleteRow.className = 'note-picker-action-row';

            var deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'menu-item danger note-picker-delete';
            deleteButton.textContent = 'Delete';
            deleteButton.dataset.noteId = p.id;
            deleteRow.appendChild(deleteButton);

            var cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.className = 'menu-item note-picker-cancel';
            cancelButton.textContent = 'Cancel';
            deleteRow.appendChild(cancelButton);
            actionsMenu.appendChild(deleteRow);

            row.appendChild(item);
            row.appendChild(actions);
            row.appendChild(actionsMenu);
            el.notePickerList.appendChild(row);
        });
        var current = currentNote();
        var label = current ? 'Notes list, current note ' + (current.title || 'Untitled') : 'Notes list';
        el.noteSelectBtn.setAttribute('aria-label', el.notePicker.hidden ? 'Open ' + label : 'Close ' + label);
        el.noteSelectBtn.title = el.noteSelectBtn.getAttribute('aria-label');
    }

    function closeNotePicker(restoreFocus) {
        el.notePicker.hidden = true;
        el.noteSelectBtn.setAttribute('aria-expanded', 'false');
        el.noteSelectBtn.querySelector('.codicon').classList.replace('codicon-layout-sidebar-left', 'codicon-layout-sidebar-left-off');
        document.body.classList.remove('compact-title-editing');
        closePickerActions();
        renderOptions();
        if (restoreFocus) { el.noteSelectBtn.focus(); }
    }

    function closePickerActions() {
        var menus = el.notePickerList.querySelectorAll('.note-picker-actions-menu');
        Array.prototype.forEach.call(menus, function (menu) {
            menu.hidden = true;
            menu.classList.remove('opens-up');
            var trigger = menu.parentElement.querySelector('.note-picker-actions-trigger');
            if (trigger) { trigger.setAttribute('aria-expanded', 'false'); }
        });
    }

    function openNotePicker(focusLast) {
        el.notePicker.hidden = false;
        el.noteSelectBtn.setAttribute('aria-expanded', 'true');
        el.noteSelectBtn.querySelector('.codicon').classList.replace('codicon-layout-sidebar-left-off', 'codicon-layout-sidebar-left');
        renderOptions();
        var options = el.notePickerList.querySelectorAll('[role="option"]');
        var target = focusLast ? options[options.length - 1] : el.notePickerList.querySelector('[aria-selected="true"]') || options[0];
        if (target) { target.focus(); }
    }

    function chooseNote(index) {
        if (index < 0 || index >= pages.length) { return; }
        el.noteSelect.value = String(index);
        el.noteSelect.dispatchEvent(new Event('change', { bubbles: true }));
        closeNotePicker(true);
    }

    function renderFooter() {
        var n = currentNote();
        if (!n) { return; }
        el.scopeChip.hidden = false;
        el.scopeChip.textContent = scope === 'workspace' ? 'Project' : 'Global';
        el.edited.textContent = footerActivityStatus || footerSaveStatus ||
            (n.updated ? 'Edited ' + formatAgo(n.updated, Date.now()) : '');

        var t = taskStats(n.content);
        el.tasks.hidden = !t.total;
        el.footerMeta.hidden = !t.total;
        el.progressTrack.hidden = !t.total;
        if (t.total) {
            el.tasks.textContent = t.done + '/' + t.total + ' done';
            el.progressBar.style.width = Math.round((t.done / t.total) * 100) + '%';
        }
    }

    function renderChrome() {
        var n = currentNote();
        renderOptions();
        var pinned = !!(n && n.pinned);
        el.pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
        el.pinBtn.title = pinned ? 'Unpin note' : 'Pin note to the top';
        syncPinnedMenuActionStates();

        var links = noteLinks(n);
        el.linkRow.replaceChildren();
        el.linkRow.hidden = !links.length;
        links.forEach(function (link, index) {
            var item = document.createElement('div');
            item.className = 'attached-link';

            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'link-btn';
            button.dataset.linkAction = 'open';
            button.dataset.linkIndex = String(index);
            button.title = 'Open ' + link.label + ' at line ' + link.line;
            button.setAttribute('aria-label', button.title);
            button.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/></svg>';
            var text = document.createElement('span');
            text.textContent = link.label + ':' + link.line;
            button.appendChild(text);
            item.appendChild(button);

            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'icon-btn small';
            remove.dataset.linkAction = 'remove';
            remove.dataset.linkIndex = String(index);
            remove.title = 'Remove file link';
            remove.setAttribute('aria-label', 'Remove link to ' + link.label);
            remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
            item.appendChild(remove);
            el.linkRow.appendChild(item);
        });
        renderFooter();
        if (menuOpen || toolbarPinned.some(function (id) { return id.indexOf('menu:') === 0; })) {
            buildMenu();
        }
    }

    function renderPreview() {
        var n = currentNote();
        var isEmpty = !n || !n.content.trim();
        el.preview.classList.toggle('is-empty', isEmpty);
        if (isEmpty) {
            el.preview.innerHTML = '<button type="button" class="preview-empty-edit">Nothing to preview yet. Click to edit.</button>';
            return;
        }
        var previewContent = autoFenceCode(n.content) || n.content;
        var lineMap = previewContent === n.content ? null : buildPreviewLineMap(n.content, previewContent);
        el.preview.innerHTML = renderMarkdown(previewContent, lineMap);
        enablePreviewTasks(previewContent, lineMap);
        if (window.hljs) {
            Array.prototype.forEach.call(el.preview.querySelectorAll('pre code[class^="language-"]'), function (code) {
                var language = code.className.slice('language-'.length);
                if (window.hljs.getLanguage(language)) { window.hljs.highlightElement(code); }
            });
        }
        reselectImage();
    }

    function enablePreviewTasks(markdown, sourceLineMap) {
        var lines = markdown.split('\n');
        var taskLines = [];
        var fenceCharacter = '';
        var fenceLength = 0;

        lines.forEach(function (line, index) {
            var fence = /^\s*(`{3,}|~{3,})/.exec(line);
            if (fence) {
                var character = fence[1].charAt(0);
                if (!fenceCharacter) {
                    fenceCharacter = character;
                    fenceLength = fence[1].length;
                } else if (character === fenceCharacter && fence[1].length >= fenceLength && /^\s*(`{3,}|~{3,})\s*$/.test(line)) {
                    fenceCharacter = '';
                    fenceLength = 0;
                }
                return;
            }
            if (!fenceCharacter && /^\s*[-*+] \[([ xX])\]/.test(line)) { taskLines.push(index); }
        });

        var checkboxes = el.preview.querySelectorAll('input[type="checkbox"]');
        Array.prototype.forEach.call(checkboxes, function (checkbox, index) {
            var taskLine = taskLines[index];
            if (taskLine === undefined) { return; }
            var sourceLine = sourceLineMap ? sourceLineMap[taskLine] : taskLine;
            if (sourceLine === null || sourceLine === undefined) { return; }
            checkbox.disabled = false;
            checkbox.removeAttribute('disabled');
            checkbox.dataset.line = String(sourceLine);
            checkbox.setAttribute('aria-label', checkbox.checked ? 'Mark task incomplete' : 'Mark task complete');
            var item = checkbox.closest('li');
            if (item) {
                item.classList.add('task');
                item.classList.toggle('done', checkbox.checked);
            }
        });
    }

    /* ---------- Image resizing ---------- */

    function findSelectedImg() {
        if (!selectedImage) { return null; }
        return el.preview.querySelector('img[data-line="' + selectedImage.line + '"][data-idx="' + selectedImage.idx + '"]');
    }

    function clearImageSelection() {
        selectedImage = null;
        el.imgBar.hidden = true;
        el.imgHandle.hidden = true;
        var old = el.preview.querySelector('img.selected');
        if (old) { old.classList.remove('selected'); }
    }

    function positionImageTools() {
        var img = findSelectedImg();
        if (!img || el.preview.hidden) { el.imgHandle.hidden = true; return; }
        var r = img.getBoundingClientRect();
        var p = el.preview.getBoundingClientRect();
        var host = el.preview.parentElement.getBoundingClientRect();
        var inView = r.bottom >= p.top + 6 && r.bottom <= p.bottom - 2;
        el.imgHandle.hidden = !inView;
        if (!inView) { return; }
        var x = Math.min(r.right, p.right - 10);
        el.imgHandle.style.left = Math.round(x - host.left - 6) + 'px';
        el.imgHandle.style.top = Math.round(r.bottom - host.top - 6) + 'px';
    }

    function reselectImage() {
        if (!selectedImage || el.preview.hidden) { return; }
        var img = findSelectedImg();
        if (!img) { clearImageSelection(); return; }
        var prev = el.preview.querySelector('img.selected');
        if (prev && prev !== img) { prev.classList.remove('selected'); }
        img.classList.add('selected');
        el.imgBar.hidden = false;
        positionImageTools();
    }

    function selectImage(img) {
        selectedImage = { line: Number(img.getAttribute('data-line')), idx: Number(img.getAttribute('data-idx')) };
        reselectImage();
    }

    function findImageMarkdown(line, idx) {
        var masked = line.replace(/`[^`]*`/g, function (m) { return new Array(m.length + 1).join('x'); });
        var re = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+|data:image\/[^\s)]+|img:[A-Za-z0-9._-]+)\)/g;
        var match;
        var imageIndex = 0;
        while ((match = re.exec(masked))) {
            if (imageIndex === idx) {
                return {
                    start: match.index,
                    end: match.index + match[0].length,
                    markdown: line.slice(match.index, match.index + match[0].length)
                };
            }
            imageIndex++;
        }
        return null;
    }

    var imageContextMenu = document.createElement('div');
    imageContextMenu.className = 'image-context-menu';
    imageContextMenu.setAttribute('role', 'menu');
    imageContextMenu.setAttribute('aria-label', 'Image actions');
    imageContextMenu.hidden = true;
    [
        { action: 'copy', label: 'Copy image' },
        { action: 'cut', label: 'Cut image' },
        { action: 'paste', label: 'Paste image' }
    ].forEach(function (item) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'image-context-menu-item';
        button.setAttribute('role', 'menuitem');
        button.dataset.imageAction = item.action;
        button.textContent = item.label;
        imageContextMenu.appendChild(button);
    });
    document.body.appendChild(imageContextMenu);

    function closeImageContextMenu() {
        imageContextMenu.hidden = true;
    }

    function openImageContextMenu(img, x, y) {
        selectImage(img);
        imageContextMenu.hidden = false;
        var bounds = imageContextMenu.getBoundingClientRect();
        imageContextMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - bounds.width - 4)) + 'px';
        imageContextMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - bounds.height - 4)) + 'px';
        var firstAction = imageContextMenu.querySelector('button');
        if (firstAction) { firstAction.focus(); }
    }

    function imageAsPng(img) {
        if (!img.complete || !img.naturalWidth) {
            return Promise.reject(new Error('The image has not finished loading.'));
        }
        if (typeof createImageBitmap !== 'function') {
            return Promise.reject(new Error('Image conversion is unavailable.'));
        }
        return createImageBitmap(img).then(function (bitmap) {
            var canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            var context = canvas.getContext('2d');
            if (!context) {
                if (bitmap.close) { bitmap.close(); }
                throw new Error('Image conversion is unavailable.');
            }
            context.drawImage(bitmap, 0, 0);
            if (bitmap.close) { bitmap.close(); }
            return new Promise(function (resolve, reject) {
                canvas.toBlob(function (png) {
                    if (png) { resolve(png); }
                    else { reject(new Error('Image conversion failed.')); }
                }, 'image/png');
            });
        });
    }

    function copySelectedImage() {
        var img = findSelectedImg();
        if (!img) { return Promise.reject(new Error('No image is selected.')); }
        if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || !window.ClipboardItem) {
            return Promise.reject(new Error('Image clipboard access is unavailable.'));
        }
        var image = imageAsPng(img);
        return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': image })]);
    }

    function getSelectedImageMarkdown() {
        var n = currentNote();
        if (!n || !selectedImage) { return false; }
        var lines = n.content.split('\n');
        var line = lines[selectedImage.line];
        if (line === undefined) { return false; }
        var match = findImageMarkdown(line, selectedImage.idx);
        if (!match) { return false; }
        return {
            noteId: n.id,
            line: selectedImage.line,
            idx: selectedImage.idx,
            markdown: match.markdown
        };
    }

    function removeSelectedImage(target) {
        var n = currentNote();
        if (!n || !selectedImage || target && target.noteId !== n.id) { return false; }
        var lineIndex = target ? target.line : selectedImage.line;
        var imageIndex = target ? target.idx : selectedImage.idx;
        var lines = n.content.split('\n');
        var line = lines[lineIndex];
        if (line === undefined) { return false; }
        var match = findImageMarkdown(line, imageIndex);
        if (!match) { return false; }
        line = line.slice(0, match.start) + line.slice(match.end);
        if (line.trim()) { lines[lineIndex] = line; }
        else { lines.splice(lineIndex, 1); }
        n.content = lines.join('\n');
        n.updated = Date.now();
        el.noteInput.value = n.content;
        clearImageSelection();
        markDirty();
        renderOptions();
        renderFooter();
        renderPreview();
        return true;
    }

    function pasteImageFromClipboard() {
        if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
            flash('Clipboard image access is unavailable. Use Ctrl+V to paste an image.');
            return;
        }
        navigator.clipboard.read().then(function (items) {
            var types = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
            for (var i = 0; i < items.length; i++) {
                for (var j = 0; j < types.length; j++) {
                    if (items[i].types.indexOf(types[j]) !== -1) {
                        return items[i].getType(types[j]).then(function (blob) {
                            if (!sendImageFile(blob, true)) { flash('Clipboard image format is not supported'); }
                        });
                    }
                }
            }
            flash('The clipboard does not contain a supported image');
        }).catch(function () {
            flash('Could not read the image clipboard. Use Ctrl+V or allow clipboard access.');
        });
    }

    imageContextMenu.addEventListener('click', function (e) {
        var button = e.target.closest('button[data-image-action]');
        if (!button) { return; }
        e.preventDefault();
        e.stopPropagation();
        var action = button.dataset.imageAction;
        closeImageContextMenu();
        if (action === 'paste') {
            pasteImageFromClipboard();
            return;
        }
        if (action === 'cut') {
            var cutTarget = getSelectedImageMarkdown();
            if (!cutTarget) {
                flash('Could not find the selected image in the note');
                return;
            }
            copySelectedImage().then(function () {
                if (removeSelectedImage(cutTarget)) { flash('Image cut'); }
                else { flash('Image copied, but could not remove it from the note'); }
            }).catch(function () {
                pendingImageCut = {
                    id: ++imageCutRequestId,
                    target: cutTarget
                };
                vscode.postMessage({
                    type: 'copyImageMarkdownForCut',
                    requestId: pendingImageCut.id,
                    markdown: cutTarget.markdown
                });
            });
            return;
        }
        copySelectedImage().then(function () {
            flash('Copied');
        }).catch(function () {
            flash('Could not copy the image. Check clipboard permission and image access.');
        });
    });

    function availableImageWidth() {
        return Math.max(60, el.preview.clientWidth - 24);
    }

    function commitImageWidth(width) {
        var n = currentNote();
        if (!n || !selectedImage) { return; }
        var lines = n.content.split('\n');
        var before = lines[selectedImage.line];
        if (before === undefined) { return; }
        var after = setImageWidthInLine(before, selectedImage.idx, width);
        if (after === before) { return; }
        lines[selectedImage.line] = after;
        n.content = lines.join('\n');
        n.updated = Date.now();
        el.noteInput.value = n.content;
        markDirty();
        renderOptions();
        renderFooter();
        renderPreview();
    }

    function loadNoteIntoInputs() {
        var n = currentNote();
        if (!n) { return; }
        el.noteInput.value = n.content;
        el.titleInput.value = n.title === 'Untitled' ? '' : n.title;
        if (previewMode) { renderPreview(); }
    }

    // Updates what is on screen only
    function applyPreview(on) {
        previewMode = on;
        var n = currentNote();
        if (!on && n) {
            var restored = legacyAutoFenceBody(n.content);
            if (restored !== null) {
                n.content = restored;
                n.updated = Date.now();
                el.noteInput.value = restored;
                markDirty();
            }
        }
        el.noteInput.hidden = on;
        el.preview.hidden = !on;
        el.previewBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        el.previewBtn.title = on ? 'Previewing. Click to edit' : 'Preview markdown';
        syncPinnedMenuActionStates();
        if (!on) { clearImageSelection(); }
        if (on) {
            renderPreview();
            var runtimePromise = loadMarkdownRuntime();
            if (runtimePromise) {
                runtimePromise.then(function (loaded) {
                    if (loaded && previewMode) { renderPreview(); }
                });
            }
        }
        saveViewState();
    }

    // Changes the mode and remembers it for the current note
    function setPreview(on) {
        var n = currentNote();
        if (n && !!n.preview !== on) {
            if (on) { n.preview = true; } else { delete n.preview; }
            markDirty();
        }
        applyPreview(on);
    }

    function applySettings(next) {
        if (next) { settings = Object.assign(settings, next); }
        document.documentElement.style.setProperty('--note-font-size', settings.fontSize + 'px');
    }

    function setFontSize(size) {
        size = Math.max(1, Math.min(24, Math.round(size)));
        if (size === settings.fontSize) { return; }
        settings.fontSize = size;
        document.documentElement.style.setProperty('--note-font-size', size + 'px');
        var menuValue = el.menu.querySelector('.stepper .value');
        if (menuValue) { menuValue.textContent = size + 'px'; }
        vscode.postMessage({ type: 'setFontSize', size: size });
    }

    function showNote(id) {
        persistIfPending();
        clearImageSelection();
        currentId = id;
        notifyCurrentNoteChanged();
        var shown = currentNote();
        applyPreview(!!(shown && shown.preview));
        loadNoteIntoInputs();
        renderChrome();
        saveViewState();
    }

    /* ---------- Editing ---------- */

    function onEdit() {
        var n = currentNote();
        if (!n) { return; }
        markCurrentNoteTouched();
        var t = el.titleInput.value.trim();
        n.title = t.length ? t : 'Untitled';
        n.content = el.noteInput.value;
        n.updated = Date.now();
        markDirty();
        renderOptions();
        renderFooter();
    }

    function setContentFromPreview(content) {
        var n = currentNote();
        if (!n) { return; }
        markCurrentNoteTouched();
        n.content = content;
        n.updated = Date.now();
        el.noteInput.value = content;
        markDirty();
        renderOptions();
        renderFooter();
    }

    function commitMeta(noteId) {
        markNoteTouched(noteId || currentId);
        renderChrome();
        markDirty();
    }

    function closeTransientUi() {
        closeNotePicker(false);
        closeMenu();
        closePanel();
        closeToolbarContextMenu();
        closeImageContextMenu();
        clearImageSelection();
        lastInvokedMenuActionId = null;
        syncPinnedMenuActionStates();
        window.dispatchEvent(new Event('notes-panel-open'));
    }

    function addNote() {
        closeTransientUi();
        persistIfPending();
        var current = currentNote();
        if (current && current.id === untouchedNewNoteId && isBlankNote(current) && !current.pinned && !current.color) {
            setPreview(false);
            if (isCompactToolbar()) {
                document.body.classList.add('compact-title-editing');
            }
            el.titleInput.focus();
            return;
        }
        var n = makeNote();
        pages.push(n);
        currentId = n.id;
        untouchedNewNoteId = n.id;
        newNoteMenuId = n.id;
        newNoteMenuLayout = 'labels';
        notifyCurrentNoteChanged();
        setPreview(false);
        loadNoteIntoInputs();
        renderChrome();
        saveViewState();
        persist();
        if (isCompactToolbar()) {
            document.body.classList.add('compact-title-editing');
        }
        el.titleInput.focus();
    }

    function moveSelection(delta) {
        var i = currentIndex() + delta;
        if (i >= 0 && i < pages.length) { showNote(pages[i].id); }
    }

    function duplicateNote() {
        var i = currentIndex();
        var n = pages[i];
        if (!n) { return; }
        var copy = Object.assign({}, n, { id: uid(), title: (n.title || 'Untitled') + ' copy', updated: Date.now() });
        pages.splice(i + 1, 0, copy);
        showNote(copy.id);
        persist();
        flash('Duplicated note');
    }

    function togglePin() {
        var i = currentIndex();
        var n = pages[i];
        if (!n) { return; }
        var pinned = !n.pinned;
        pages.splice(i, 1);
        n.pinned = pinned;
        if (!n.pinned) { delete n.pinned; }
        var pinnedCount = pages.filter(function (p) { return p.pinned; }).length;
        pages.splice(n.pinned ? 0 : pinnedCount, 0, n);
        commitMeta();
        flash(pinned ? 'Pinned' : 'Unpinned');
    }

    function setColor(color, noteId) {
        var n = noteId ? pages.find(function (page) { return page.id === noteId; }) : currentNote();
        if (!n) { return; }
        if (!color || n.color === color) { delete n.color; } else { n.color = color; }
        n.updated = Date.now();
        commitMeta(n.id);
        if (menuOpen) { buildMenu(); }
    }

    function deleteCurrent() {
        var i = currentIndex();
        var n = pages[i];
        if (!n) { return; }
        var keep = !isBlankNote(n);
        pages.splice(i, 1);
        if (keep) {
            trash.unshift(Object.assign({}, n, { deletedAt: Date.now() }));
            trash = trash.slice(0, 100);
        }
        if (!pages.length) { pages.push(makeNote()); }
        if (newNoteMenuId === n.id) { newNoteMenuId = null; }
        lastDeleted = { note: n, index: i };
        // Land on the note before the deleted one so the removal is obvious
        currentId = pages[Math.max(0, Math.min(i - 1, pages.length - 1))].id;
        notifyCurrentNoteChanged();
        clearImageSelection();
        applyPreview(!!currentNote().preview);
        loadNoteIntoInputs();
        renderChrome();
        saveViewState();
        persist();
        flash('Deleted note ' + (i + 1), true);
    }

    function deleteNoteById(id) {
        var i = pages.findIndex(function (note) { return note.id === id; });
        if (i < 0) { return; }
        if (currentId === id) {
            deleteCurrent();
            return;
        }
        persistIfPending();
        var n = pages[i];
        pages.splice(i, 1);
        if (!isBlankNote(n)) {
            trash.unshift(Object.assign({}, n, { deletedAt: Date.now() }));
            trash = trash.slice(0, 100);
        }
        if (untouchedNewNoteId === id) { untouchedNewNoteId = null; }
        if (newNoteMenuId === id) { newNoteMenuId = null; }
        lastDeleted = { note: n, index: i };
        renderChrome();
        saveViewState();
        persist();
        flash('Deleted note ' + (i + 1), true);
    }

    function undoDelete() {
        if (!lastDeleted) { return; }
        var d = lastDeleted;
        lastDeleted = null;
        trash = trash.filter(function (t) { return t.id !== d.note.id; });
        if (pages.length === 1 && isBlankNote(pages[0])) { pages = []; }
        pages.splice(Math.min(d.index, pages.length), 0, d.note);
        keepPinnedFirst();
        showNote(d.note.id);
        persist();
        flash('Restored note');
    }

    function restoreFromTrash(id) {
        var idx = -1;
        for (var k = 0; k < trash.length; k++) {
            if (trash[k].id === id) { idx = k; break; }
        }
        if (idx < 0) { return; }
        var n = trash.splice(idx, 1)[0];
        delete n.deletedAt;
        if (pages.length === 1 && isBlankNote(pages[0])) { pages = []; }
        pages.push(n);
        keepPinnedFirst();
        showNote(n.id);
        persist();
        renderPanel();
        flash('Restored note');
    }

    function insertChecklistItem() {
        setPreview(false);
        var ta = el.noteInput;
        ta.focus();
        var pos = ta.selectionStart;
        var atLineStart = pos === 0 || ta.value.charAt(pos - 1) === '\n';
        var text = (atLineStart ? '' : '\n') + '- [ ] ';
        try {
            document.execCommand('insertText', false, text);
        } catch (err) {
            var start = ta.selectionStart;
            ta.setRangeText(text, start, ta.selectionEnd, 'end');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
        flash('Checklist item added');
    }

    function insertImageMarkdown(file) {
        var n = currentNote();
        if (!n) { return; }
        var line = '![image](img:' + file + ')';

        if (previewMode) {
            // No text cursor while previewing, so add the picture at the end of the note
            var existing = n.content.replace(/\s+$/, '');
            n.content = (existing ? existing + '\n\n' : '') + line + '\n';
            n.updated = Date.now();
            el.noteInput.value = n.content;
            markDirty();
            renderOptions();
            renderFooter();
            renderPreview();
        } else {
            var ta = el.noteInput;
            ta.focus();
            var pos = ta.selectionStart;
            var atLineStart = pos === 0 || ta.value.charAt(pos - 1) === '\n';
            var text = (atLineStart ? '' : '\n') + line + '\n';
            var inserted = false;
            try { inserted = document.execCommand('insertText', false, text); } catch (err) { }
            if (!inserted) { ta.setRangeText(text, pos, ta.selectionEnd, 'end'); }
            onEdit();
            setPreview(true);
        }

        // Bring the new picture into view
        var img = el.preview.querySelector('img[src$="' + file + '"]');
        if (img && img.scrollIntoView) { img.scrollIntoView({ block: 'nearest' }); }
        flash('Image added');
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function () {
                var data = String(reader.result);
                resolve(data.slice(data.indexOf(',') + 1));
            };
            reader.readAsDataURL(blob);
        });
    }

    // Shrinks big pictures (max 1600px wide, WebP) so they stay small when kept with the notes.
    // Animated GIFs and tiny images are kept as they are.
    function compressImage(blob) {
        if (blob.type === 'image/gif' || typeof createImageBitmap !== 'function') { return Promise.resolve(blob); }
        return createImageBitmap(blob).then(function (bmp) {
            var scale = Math.min(1, 1600 / bmp.width);
            var w = Math.max(1, Math.round(bmp.width * scale));
            var h = Math.max(1, Math.round(bmp.height * scale));
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
            if (bmp.close) { bmp.close(); }
            return new Promise(function (resolve) {
                canvas.toBlob(function (out) {
                    resolve(out && out.type === 'image/webp' && out.size < blob.size ? out : blob);
                }, 'image/webp', 0.85);
            });
        }).catch(function () { return blob; });
    }

    function saveCompressed(blob, pasted) {
        compressImage(blob).then(blobToBase64).then(function (data) {
            vscode.postMessage({ type: 'saveImage', data: data, pasted: pasted === true });
        });
    }

    function sendImageFile(file, pasted) {
        if (!file || !/^(image\/(png|jpeg|gif|webp))$/i.test(String(file.type)) && !/\.(png|jpe?g|gif|webp)$/i.test(String(file.name || ''))) { return false; }
        if (file.size > 8 * 1024 * 1024) { flash('Image is larger than 8 MB'); return true; }
        flash('Adding image');
        saveCompressed(file, pasted);
        return true;
    }

    // The extension read a picture file for us. Shrink it, then send it back to be saved.
    function processImageData(base64) {
        flash('Adding image');
        var bin = atob(base64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
        var type = bytes[0] === 0x47 ? 'image/gif' : bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : 'image/webp';
        saveCompressed(new Blob([bytes], { type: type }));
    }

    function insertSelection(msg) {
        persistIfPending();
        var ref = msg.link ? msg.link.label + ':' + msg.link.line : '';
        var fence = '```';
        var lang = msg.language && msg.language !== 'plaintext' ? msg.language : '';
        var block = fence + lang + '\n' + String(msg.text).replace(/\s+$/, '') + '\n' + fence;
        var body = (ref ? ref + '\n' : '') + block + '\n';
        var n;
        if (msg.newNote) {
            var fileName = msg.link ? msg.link.label.split(/[\\/]/).pop() : 'Snippet';
            n = makeNote(fileName);
            n.content = body;
            pages.push(n);
        } else {
            n = currentNote();
            if (!n) { return; }
            var existing = n.content.replace(/\s+$/, '');
            n.content = existing ? existing + '\n\n' + body : body;
        }
        addNoteLink(n, msg.link);
        n.updated = Date.now();
        currentId = n.id;
        notifyCurrentNoteChanged();
        setPreview(false);
        loadNoteIntoInputs();
        renderChrome();
        el.noteInput.scrollTop = el.noteInput.scrollHeight;
        persist();
        flash(msg.newNote ? 'Created note from selection' : 'Added selection to note');
    }

    function insertTerminalCommand(msg) {
        persistIfPending();
        var cmd = String(msg.command || '').trim();
        if (!cmd) { return; }
        var firstLine = cmd.split(/\r?\n/)[0];
        var title = firstLine.length > 28 ? firstLine.slice(0, 28) + '...' : firstLine;
        var block = '```bash\n' + cmd + '\n```';
        var body = block + (msg.cwd ? '\n\n> In `' + msg.cwd + '`\n' : '\n');
        var n;
        if (msg.newNote) {
            n = makeNote('Terminal: ' + title);
            n.content = body;
            pages.push(n);
        } else {
            n = currentNote();
            if (!n) { return; }
            var existing = n.content.replace(/\s+$/, '');
            n.content = existing ? existing + '\n\n' + body : body;
        }
        n.updated = Date.now();
        currentId = n.id;
        notifyCurrentNoteChanged();
        setPreview(false);
        loadNoteIntoInputs();
        renderChrome();
        el.noteInput.scrollTop = el.noteInput.scrollHeight;
        persist();
        flash(msg.newNote ? 'Created note from terminal' : 'Added terminal command to note');
    }

    /* ---------- Confirm helper ---------- */

    function armConfirm(btn, idleText, armedText, action) {
        var label = btn.querySelector('.confirm-label') || btn;
        if (btn.dataset.armed === '1') {
            clearTimeout(confirmTimers.get(btn));
            btn.dataset.armed = '';
            label.textContent = idleText;
            btn.classList.remove('armed');
            action();
            return;
        }
        btn.dataset.armed = '1';
        label.textContent = armedText;
        btn.classList.add('armed');
        confirmTimers.set(btn, setTimeout(function () {
            btn.dataset.armed = '';
            label.textContent = idleText;
            btn.classList.remove('armed');
        }, 3000));
    }

    /* ---------- Menu ---------- */

    function closeMenu() {
        if (!menuOpen) { return; }
        menuOpen = false;
        el.menu.hidden = true;
        el.preview.classList.remove('menu-open');
        if (selectedImage) { reselectImage(); }
        el.menuBtn.setAttribute('aria-expanded', 'false');
    }

    function menuIcon(label) {
        var key = label.toLowerCase();
        var iconName = 'default';
        if (key.indexOf('duplicate') === 0) { iconName = 'duplicate'; }
        else if (key.indexOf('pin') === 0 || key.indexOf('unpin') === 0) { iconName = 'pin'; }
        else if (key === 'edit note' || key.indexOf('preview') === 0 || key.indexOf('markdown') >= 0) { iconName = 'preview'; }
        else if (key.indexOf('edit') === 0 || key.indexOf('suggest title') === 0) { iconName = 'edit'; }
        else if (key.indexOf('search') === 0) { iconName = 'search'; }
        else if (key.indexOf('copy') === 0) { iconName = 'copy'; }
        else if (key.indexOf('extract') === 0 || key.indexOf('tasks') >= 0) { iconName = 'extract'; }
        else if (key.indexOf('checklist') >= 0) { iconName = 'checklist'; }
        else if (key.indexOf('image') >= 0) { iconName = 'image'; }
        else if (key.indexOf('attach') === 0) { iconName = 'attach'; }
        else if (key.indexOf('terminal') >= 0) { iconName = 'terminal'; }
        else if (key.indexOf('trash') === 0) { iconName = 'trash'; }
        else if (key.indexOf('delete') === 0) { iconName = 'delete'; }
        else if (key.indexOf('export all') === 0 || key.indexOf('global notes') >= 0) { iconName = 'exportAll'; }
        else if (key.indexOf('export') === 0 || key.indexOf('download') === 0) { iconName = 'export'; }
        else if (key.indexOf('import') === 0) { iconName = 'import'; }
        else if (key.indexOf('settings') === 0 || key.indexOf('model') >= 0) { iconName = 'settings'; }
        else if (key.indexOf('project') >= 0 || key.indexOf('global') >= 0) { iconName = 'scope'; }
        else if (key.indexOf('label') === 0) { iconName = 'label'; }
        else if (key.indexOf('summarize') === 0) { iconName = 'summary'; }
        else if (key.indexOf('explain') === 0) { iconName = 'explain'; }
        else if (key.indexOf('ask ') === 0) { iconName = 'ask'; }
        var codicons = {
            duplicate: 'repo-clone',
            pin: 'pin',
            preview: 'eye',
            edit: 'edit',
            search: 'search',
            copy: 'copy',
            checklist: 'checklist',
            extract: 'fold-down',
            image: 'file-media',
            attach: 'link',
            terminal: 'terminal',
            trash: 'trash',
            delete: 'trash',
            export: 'cloud-download',
            exportAll: 'files',
            import: 'cloud-upload',
            settings: 'settings-gear',
            scope: 'globe',
            label: 'tag',
            ai: 'sparkle',
            summary: 'list-unordered',
            explain: 'warning',
            ask: 'comment',
            default: 'symbol-misc'
        };
        return '<span class="menu-item-icon codicon codicon-' + codicons[iconName] + '" aria-hidden="true"></span>';
    }

    function menuToolbarActionId(label) {
        var key = label.toLowerCase();
        if (key.indexOf('pin note') === 0 || key.indexOf('unpin note') === 0) { return 'pinBtn'; }
        if (key.indexOf('preview markdown') === 0 || key.indexOf('edit note') === 0) { return 'previewBtn'; }
        if (key.indexOf('search notes') === 0) { return 'searchBtn'; }
        if (key.indexOf("show today's terminal commands") === 0 || key.indexOf('new note from terminal') === 0) { return 'terminalBtn'; }
        return 'menu:' + key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function addMenuItem(label, onClick, opts) {
        opts = opts || {};
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-item' + (opts.danger ? ' danger' : '');
        var toolbarActionId = menuToolbarActionId(label);
        b.dataset.toolbarAction = toolbarActionId;
        if (opts.pinnable === false) { b.dataset.toolbarPinnable = 'false'; }
        if (label === 'Trash') {
            b.classList.add('menu-item-trash');
        }
        if (label === 'Preview markdown' || label === 'Edit note') {
            b.classList.add('menu-item-preview');
        }
        b.setAttribute('role', 'menuitem');
        b.setAttribute('aria-label', label + (opts.hint ? ', ' + opts.hint : ''));
        var content = document.createElement('span');
        content.className = 'menu-item-content';
        content.innerHTML = opts.icon || menuIcon(label);
        var span = document.createElement('span');
        span.className = 'menu-item-label';
        span.textContent = label;
        content.appendChild(span);
        b.appendChild(content);
        if (opts.hint) {
            var h = document.createElement('span');
            h.className = 'hint';
            h.textContent = opts.hint;
            b.appendChild(h);
        }
        if (opts.disabled) { b.disabled = true; }
        if (toolbarActionId.indexOf('menu:') === 0) {
            menuToolbarActions[toolbarActionId] = {
                label: label,
                icon: opts.icon || menuIcon(label),
                button: b
            };
        }
        b.addEventListener('click', function () {
            if (opts.confirm) {
                if (b.dataset.armed === '1') {
                    if (!menuUsesIconsOnly()) { closeMenu(); }
                    onClick();
                    return;
                }
                b.dataset.armed = '1';
                span.textContent = opts.confirm;
                b.classList.add('armed');
                setTimeout(function () {
                    b.dataset.armed = '';
                    span.textContent = label;
                    b.classList.remove('armed');
                }, 3000);
                return;
            }
            if (!opts.keepOpen && !menuUsesIconsOnly()) { closeMenu(); }
            onClick();
        });
        var content = el.menu.querySelector('.menu-content');
        (content || el.menu).appendChild(b);
        return b;
    }

    function addMenuSep(className) {
        var s = document.createElement('div');
        s.className = 'menu-sep' + (className ? ' ' + className : '');
        s.setAttribute('role', 'separator');
        var content = el.menu.querySelector('.menu-content');
        (content || el.menu).appendChild(s);
    }

    function isUntouchedNewNote() {
        return !!untouchedNewNoteId && currentId === untouchedNewNoteId;
    }

    function currentMenuLayout() {
        return newNoteMenuId && currentId === newNoteMenuId ? newNoteMenuLayout : menuLayout;
    }

    function menuUsesIconsOnly() {
        var layout = currentMenuLayout();
        return layout === 'icons' ||
            (layout === 'auto' && (
                el.titleRow.clientWidth <= 120 ||
                (el.menu.offsetWidth > 0 && el.menu.offsetWidth <= 52)
            ));
    }

    function addMenuLayoutToggle(header) {
        var showLabels = menuUsesIconsOnly();
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu-layout-toggle';
        button.setAttribute('aria-label', showLabels ? 'Show action labels' : 'Show icons only');
        button.setAttribute('aria-pressed', showLabels ? 'true' : 'false');
        button.innerHTML = showLabels
            ? '<span class="codicon codicon-chevron-left" aria-hidden="true"></span>'
            : '<span class="codicon codicon-chevron-right" aria-hidden="true"></span>';
        button.addEventListener('click', function () {
            var nextLayout = showLabels ? 'labels' : 'icons';
            if (newNoteMenuId && currentId === newNoteMenuId) {
                newNoteMenuLayout = nextLayout;
            } else {
                menuLayout = nextLayout;
                saveViewState();
            }
            el.menu.classList.toggle('icons-only', nextLayout === 'icons');
            el.menu.classList.toggle('labels-only', nextLayout === 'labels');
            buildMenu();
            var toggle = el.menu.querySelector('.menu-layout-toggle');
            if (toggle) { toggle.focus(); }
        });
        header.appendChild(button);
    }

    function buildMenu() {
        var n = currentNote();
        var layout = currentMenuLayout();
        menuToolbarActions = Object.create(null);
        el.menu.innerHTML = '';
        el.menu.classList.toggle('icons-only', layout === 'icons');
        el.menu.classList.toggle('labels-only', layout === 'labels');
        var header = document.createElement('div');
        header.className = 'menu-header';
        el.menu.appendChild(header);
        addMenuLayoutToggle(header);
        var closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'menu-close';
        closeButton.setAttribute('role', 'menuitem');
        closeButton.setAttribute('aria-label', 'Close actions menu');
        closeButton.innerHTML = '<span class="codicon codicon-close" aria-hidden="true"></span>';
        closeButton.addEventListener('click', function () {
            closeMenu();
            el.menuBtn.focus();
        });
        header.appendChild(closeButton);
        var content = document.createElement('div');
        content.className = 'menu-content';
        el.menu.appendChild(content);

        addMenuItem('Duplicate note', duplicateNote);
        addMenuItem('Copy note', function () {
            vscode.postMessage({ type: 'copy', text: n ? n.content : '' });
        });
        addMenuItem(n && n.pinned ? 'Unpin note' : 'Pin note to the top', togglePin);
        addMenuItem(previewMode ? 'Edit note' : 'Preview markdown', function () {
            var enteringEditMode = previewMode;
            setPreview(!previewMode);
            if (enteringEditMode) { el.noteInput.focus(); }
        });
        addMenuSep();
        addMenuItem('Search notes', function () { openPanel('search'); });
        addMenuItem('Add checklist item', insertChecklistItem);
        addMenuItem('Insert image from file', function () {
            persistIfPending();
            vscode.postMessage({ type: 'pickImage' });
        });
        addMenuItem('Attach current file', function () {
            vscode.postMessage({ type: 'attachLink' });
        }, { hint: 'from editor' });
        addMenuItem("Show today's terminal commands", function () {
            vscode.postMessage({ type: 'showTerminalCommands' });
        }, { hint: '>_' });

        if (window.notesAi) { window.notesAi.addMenuItems(addMenuItem, addMenuSep); }

        addMenuSep();
        addMenuItem('Trash', function () { openPanel('trash'); }, { hint: String(trash.length) });
        addMenuItem('Export current note', function () {
            persistIfPending();
            var current = currentNote();
            if (current) {
                setFooterActivityStatus('Choose export format');
                vscode.postMessage({ type: 'exportCurrent', id: current.id });
            }
        });
        addMenuItem('Export all global notes', function () {
            persistIfPending();
            setFooterActivityStatus('Choose export format');
            vscode.postMessage({ type: 'exportGlobal' });
        });
        addMenuItem('Import notes', function () { persistIfPending(); vscode.postMessage({ type: 'import' }); });

        var toProject = scope === 'global';
        addMenuItem(toProject ? 'Switch to project notes' : 'Switch to global notes', function () {
            persistIfPending();
            vscode.postMessage({ type: 'setScope', scope: toProject ? 'workspace' : 'global' });
        }, { disabled: toProject && !hasWorkspace, hint: toProject && !hasWorkspace ? 'open a folder' : (scope === 'global' ? 'now: global' : 'now: project'), pinnable: false });
        addMenuItem('Settings', function () { vscode.postMessage({ type: 'openSettings' }); }, { pinnable: false });
        addMenuSep();
        addMenuItem('Delete note', deleteCurrent, { danger: true, pinnable: false });

        renderPinnedMenuActions();
    }

    function openMenu() {
        closePanel();
        buildMenu();
        menuOpen = true;
        el.menu.hidden = false;
        el.preview.classList.add('menu-open');
        el.imgHandle.hidden = true;
        el.imgBar.hidden = true;
        el.menuBtn.setAttribute('aria-expanded', 'true');
        var first = el.menu.querySelector('.menu-layout-toggle, .menu-item:not(:disabled)');
        if (first) { first.focus(); }
    }

    /* ---------- Search and trash panel ---------- */

    function openPanel(mode) {
        window.dispatchEvent(new Event('notes-panel-open'));
        closeMenu();
        panelMode = mode;
        el.searchBtn.setAttribute('aria-pressed', mode === 'search' ? 'true' : 'false');
        syncPinnedMenuActionStates();
        el.panel.hidden = false;
        el.panelInput.hidden = mode !== 'search';
        el.panelTitle.hidden = mode === 'search';
        el.panelAction.hidden = mode === 'search';
        el.panelInput.value = '';
        el.panelClear.hidden = true;
        activeResult = 0;
        renderPanel();
        if (mode === 'search') { el.panelInput.focus(); }
    }

    function closePanel() {
        panelMode = null;
        el.searchBtn.setAttribute('aria-pressed', 'false');
        syncPinnedMenuActionStates();
        el.panel.hidden = true;
    }

    window.addEventListener('notes-ai-open', closePanel);

    function snippetFor(n, q) {
        var text = n.content.replace(/\s+/g, ' ').trim();
        if (q) {
            var at = text.toLowerCase().indexOf(q);
            if (at > -1) {
                var start = Math.max(0, at - 24);
                return (start > 0 ? '\u2026' : '') + text.slice(start, start + 80);
            }
        }
        return text.slice(0, 80);
    }

    function renderPanel() {
        el.panelList.innerHTML = '';
        if (panelMode === 'search') {
            var q = el.panelInput.value.trim().toLowerCase();
            visibleResults = [];
            pages.forEach(function (n, i) {
                if (!q || n.title.toLowerCase().indexOf(q) > -1 || n.content.toLowerCase().indexOf(q) > -1) {
                    visibleResults.push({ note: n, index: i });
                }
            });
            if (!visibleResults.length) {
                var empty = document.createElement('div');
                empty.className = 'panel-empty';
                empty.textContent = 'No notes match "' + el.panelInput.value.trim() + '".';
                el.panelList.appendChild(empty);
                return;
            }
            activeResult = Math.min(activeResult, visibleResults.length - 1);
            visibleResults.forEach(function (r, k) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'result' + (k === activeResult ? ' active' : '');
                b.setAttribute('role', 'option');
                var t = document.createElement('div');
                t.className = 'r-title';
                t.textContent = noteLabel(r.note, r.index);
                var s = document.createElement('div');
                s.className = 'r-snippet';
                s.textContent = snippetFor(r.note, q);
                b.appendChild(t);
                if (s.textContent) { b.appendChild(s); }
                b.addEventListener('click', function () { openResult(k); });
                el.panelList.appendChild(b);
            });
        } else if (panelMode === 'trash') {
            el.panelTitle.textContent = 'Trash (' + trash.length + ')';
            el.panelAction.textContent = 'Empty trash';
            el.panelAction.disabled = !trash.length;
            if (!trash.length) {
                var e2 = document.createElement('div');
                e2.className = 'panel-empty';
                e2.textContent = 'Trash is empty. Deleted notes stay here for ' + settings.trashRetentionDays + ' days.';
                el.panelList.appendChild(e2);
                return;
            }
            trash.forEach(function (n) {
                var item = document.createElement('div');
                item.className = 'trash-item';
                var text = document.createElement('div');
                text.className = 't-text';
                var t = document.createElement('div');
                t.className = 'r-title';
                t.textContent = n.title || 'Untitled';
                var s = document.createElement('div');
                s.className = 'r-snippet';
                s.textContent = 'Deleted ' + formatAgo(n.deletedAt || Date.now(), Date.now()) +
                    (n.content.trim() ? ': ' + snippetFor(n, '') : '');
                text.appendChild(t);
                text.appendChild(s);
                var actions = document.createElement('div');
                actions.className = 't-actions';
                var restore = document.createElement('button');
                restore.type = 'button';
                restore.className = 'text-btn';
                restore.textContent = 'Restore';
                restore.addEventListener('click', function () { restoreFromTrash(n.id); });
                var del = document.createElement('button');
                del.type = 'button';
                del.className = 'text-btn danger';
                del.textContent = 'Delete';
                del.title = 'Delete forever';
                del.addEventListener('click', function () {
                    armConfirm(del, 'Delete', 'Sure?', function () {
                        trash = trash.filter(function (t2) { return t2.id !== n.id; });
                        persist();
                        renderPanel();
                        renderChrome();
                    });
                });
                actions.appendChild(restore);
                actions.appendChild(del);
                item.appendChild(text);
                item.appendChild(actions);
                el.panelList.appendChild(item);
            });
        }
    }

    function openResult(k) {
        var r = visibleResults[k];
        if (!r) { return; }
        closePanel();
        showNote(r.note.id);
    }

    /* ---------- Events ---------- */

    if (typeof ResizeObserver !== 'undefined') {
        var toolbarResizeObserver = new ResizeObserver(updateToolbarResponsiveVisibility);
        toolbarResizeObserver.observe(el.titleRow);
    }
    el.noteInput.addEventListener('input', onEdit);
    el.titleInput.addEventListener('input', onEdit);
    [el.noteSelectBtn, el.menuBtn, el.addBtn].forEach(function (button) {
        button.addEventListener('contextmenu', function (event) {
            event.preventDefault();
            event.stopPropagation();
            closeToolbarContextMenu();
        });
    });
    toolbarPinOptions().forEach(function (item) {
        item.button.addEventListener('contextmenu', function (event) {
            event.stopPropagation();
            openToolbarContextMenu(event, item.id);
        });
    });
    el.menu.addEventListener('contextmenu', function (event) {
        var item = event.target.closest && event.target.closest('.menu-item');
        if (!item || !item.dataset.toolbarAction) { return; }
        event.preventDefault();
        event.stopPropagation();
        if (item.dataset.toolbarPinnable === 'false') { return; }
        var actionId = item.dataset.toolbarAction;
        if (actionId.indexOf('menu:') === 0) {
            openToolbarContextMenu(event, actionId, item.getAttribute('aria-label') || item.title);
        } else {
            openToolbarContextMenu(event, actionId);
        }
    });
    el.titleRow.addEventListener('contextmenu', function (event) {
        if (event.target.closest && event.target.closest('.title-input')) { return; }
        if (event.target.closest && event.target.closest('button')) { return; }
        openToolbarContextMenu(event, null);
    });
    el.toolbarContextMenu.addEventListener('keydown', function (event) {
        var items = Array.prototype.slice.call(el.toolbarContextMenu.querySelectorAll('button'));
        var index = items.indexOf(document.activeElement);
        if (event.key === 'Escape') {
            event.preventDefault();
            closeToolbarContextMenu();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            var next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
            if (items[next]) { items[next].focus(); }
        }
    });
    el.titleInput.addEventListener('focus', function () {
        if (isCompactToolbar()) {
            document.body.classList.add('compact-title-editing');
        }
    });
    el.noteInput.addEventListener('focus', function () {
        document.body.classList.remove('compact-title-editing');
    });
    el.noteInput.addEventListener('blur', persistIfPending);
    el.titleInput.addEventListener('blur', function () {
        if (el.notePicker.hidden) { document.body.classList.remove('compact-title-editing'); }
        persistIfPending();
    });
    document.body.addEventListener('click', function (e) {
        if (e.target !== el.titleInput && !el.addBtn.contains(e.target) &&
            (el.notePicker.hidden || !el.noteSelectBtn.parentElement.contains(e.target))) {
            document.body.classList.remove('compact-title-editing');
        }
    });

    el.titleInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            setPreview(false);
            el.noteInput.focus();
        }
    });

    // Continue bullet and checklist lines when pressing Enter at the end of a line
    el.noteInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) { return; }
        var ta = el.noteInput;
        if (ta.selectionStart !== ta.selectionEnd) { return; }
        var pos = ta.selectionStart;
        if (pos === 0) { return; }
        var v = ta.value;
        var lineStart = v.lastIndexOf('\n', pos - 1) + 1;
        var lineEnd = v.indexOf('\n', pos);
        if (lineEnd === -1) { lineEnd = v.length; }
        if (pos !== lineEnd) { return; }
        var line = v.slice(lineStart, lineEnd);
        var m = /^(\s*)([-*+]) \[[ xX]\] ?(.*)$/.exec(line);
        var marker;
        if (m) {
            marker = m[1] + m[2] + ' [ ] ';
        } else {
            m = /^(\s*)([-*+]) (.*)$/.exec(line);
            if (m) { marker = m[1] + m[2] + ' '; }
        }
        if (!m) { return; }
        e.preventDefault();
        if (m[3].trim() === '') {
            ta.setSelectionRange(lineStart, pos);
            try {
                document.execCommand('delete');
            } catch (err) {
                var before = ta.value.slice(0, lineStart);
                var after = ta.value.slice(pos);
                ta.value = before + after;
                ta.setSelectionRange(lineStart, lineStart);
                onEdit();
            }
        } else {
            var insert = '\n' + marker;
            try {
                document.execCommand('insertText', false, insert);
            } catch (err) {
                var start = ta.selectionStart;
                ta.setRangeText(insert, start, ta.selectionEnd, 'end');
                onEdit();
            }
        }
    });

    // Paste a screenshot or copied image straight into the note (edit or preview mode)
    document.addEventListener('paste', function (e) {
        if (e.target === el.titleInput || e.target === el.panelInput) { return; }
        var surface = noteDropSurface(e.target);
        var items = (e.clipboardData && e.clipboardData.items) || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].kind === 'file' && String(items[i].type).indexOf('image/') === 0) {
                e.preventDefault();
                sendImageFile(items[i].getAsFile(), true);
                return;
            }
        }
        if (surface && e.clipboardData && e.clipboardData.getData('text/plain')) {
            setTimeout(function () { flash('Pasted'); }, 0);
        }
    });

    function noteDropSurface(target) {
        if (target === el.noteInput) { return el.noteInput; }
        if (target === el.preview || target && target.nodeType === 1 && el.preview.contains(target)) { return el.preview; }
        return null;
    }

    function droppedFiles(transfer) {
        var files = transfer && transfer.files ? Array.prototype.slice.call(transfer.files) : [];
        if (files.length || !transfer || !transfer.items) { return files; }
        for (var i = 0; i < transfer.items.length; i++) {
            if (transfer.items[i].kind === 'file') {
                var file = transfer.items[i].getAsFile();
                if (file) { files.push(file); }
            }
        }
        return files;
    }

    function droppedFileUris(transfer) {
        if (!transfer) { return []; }
        var values = ['text/uri-list', 'application/vnd.code.uri-list', 'text/plain'].map(function (type) {
            try { return transfer.getData(type); } catch (err) { return ''; }
        });
        var lines = values.join('\n').split(/\r?\n/);
        var seen = {};
        return lines.filter(function (value) {
            var uri = value.trim();
            if (!/^(file:|[a-z]:[\\/]|\\\\)/i.test(uri) || seen[uri]) { return false; }
            seen[uri] = true;
            return true;
        });
    }

    function isFileDrag(transfer) {
        if (!transfer) { return false; }
        var types = transfer.types || [];
        return Array.prototype.indexOf.call(types, 'Files') >= 0 ||
            Array.prototype.indexOf.call(types, 'text/uri-list') >= 0 ||
            Array.prototype.indexOf.call(types, 'application/vnd.code.uri-list') >= 0 ||
            droppedFileUris(transfer).length > 0;
    }

    document.addEventListener('dragover', function (e) {
        var surface = noteDropSurface(e.target);
        if (!surface || !isFileDrag(e.dataTransfer)) { return; }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        surface.classList.add('drag-over');
    }, true);

    document.addEventListener('dragleave', function (e) {
        var surface = noteDropSurface(e.target);
        if (surface && (!e.relatedTarget || !surface.contains(e.relatedTarget))) {
            surface.classList.remove('drag-over');
        }
    }, true);

    document.addEventListener('drop', function (e) {
        var surface = noteDropSurface(e.target);
        if (!surface || !isFileDrag(e.dataTransfer)) { return; }
        e.preventDefault();
        e.stopPropagation();
        surface.classList.remove('drag-over');
        var files = droppedFiles(e.dataTransfer);
        var uris = droppedFileUris(e.dataTransfer);
        if (files.length > 1 || files.length === 0 && uris.length > 1) {
            flash('Drop one image at a time');
            return;
        }
        if (files.length === 1) {
            if (!sendImageFile(files[0])) { flash('Drop a PNG, JPEG, GIF or WebP image'); }
            return;
        }
        if (uris.length === 1) {
            vscode.postMessage({ type: 'readDroppedImage', uri: uris[0] });
            return;
        }
        flash('Drop a PNG, JPEG, GIF or WebP image');
    }, true);

    el.noteSelect.addEventListener('change', function (e) {
        document.body.classList.remove('compact-title-editing');
        var p = pages[parseInt(e.target.value, 10)];
        if (p) { showNote(p.id); }
    });
    el.noteSelectBtn.addEventListener('click', function () {
        if (el.notePicker.hidden) { openNotePicker(false); }
        else { closeNotePicker(false); }
    });
    el.noteSelectBtn.addEventListener('mousedown', function (e) {
        if (document.body.classList.contains('compact-title-editing')) { e.preventDefault(); }
    });
    el.notePickerClose.addEventListener('click', function () { closeNotePicker(true); });
    el.notePickerSearch.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        closeNotePicker(false);
        openPanel('search');
    });
    el.noteSelectBtn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openNotePicker(e.key === 'ArrowUp');
        }
    });
    el.notePickerList.addEventListener('click', function (e) {
        var trigger = e.target.closest('.note-picker-actions-trigger');
        if (trigger) {
            e.preventDefault();
            e.stopPropagation();
            var menu = trigger.parentElement.querySelector('.note-picker-actions-menu');
            var shouldOpen = menu.hidden;
            closePickerActions();
            if (shouldOpen) {
                menu.hidden = false;
                var listBounds = el.notePickerList.getBoundingClientRect();
                var rowBounds = menu.parentElement.getBoundingClientRect();
                var menuBounds = menu.getBoundingClientRect();
                if (menuBounds.bottom > listBounds.bottom && rowBounds.top - listBounds.top >= menuBounds.height + 2) {
                    menu.classList.add('opens-up');
                }
                trigger.setAttribute('aria-expanded', 'true');
            }
            return;
        }
        var swatch = e.target.closest('button[data-note-color]');
        if (swatch) {
            e.preventDefault();
            e.stopPropagation();
            setColor(swatch.dataset.noteColor || null, swatch.dataset.noteId);
            return;
        }
        var deleteButton = e.target.closest('.note-picker-delete');
        if (deleteButton) {
            e.preventDefault();
            e.stopPropagation();
            var id = deleteButton.dataset.noteId;
            deleteNoteById(id);
            if (!el.notePicker.hidden) {
                var selected = el.notePickerList.querySelector('[aria-selected="true"]');
                if (selected) { selected.focus(); }
            }
            return;
        }
        var cancelButton = e.target.closest('.note-picker-cancel');
        if (cancelButton) {
            e.preventDefault();
            e.stopPropagation();
            var menu = cancelButton.closest('.note-picker-actions-menu');
            menu.hidden = true;
            menu.classList.remove('opens-up');
            var trigger = menu.parentElement.querySelector('.note-picker-actions-trigger');
            if (trigger) {
                trigger.setAttribute('aria-expanded', 'false');
                trigger.focus();
            }
            return;
        }
        var item = e.target.closest('[role="option"]');
        if (item) { chooseNote(Number(item.dataset.index)); }
    });
    el.notePickerList.addEventListener('keydown', function (e) {
        var row = e.target.closest('.note-picker-row');
        var actionsMenu = row && row.querySelector('.note-picker-actions-menu');
        if (actionsMenu && !actionsMenu.hidden && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            actionsMenu.hidden = true;
            var trigger = row.querySelector('.note-picker-actions-trigger');
            if (trigger) {
                trigger.setAttribute('aria-expanded', 'false');
                trigger.focus();
            }
            return;
        }
        if (e.target.closest('.note-picker-actions-trigger') || e.target.closest('.note-picker-actions-menu')) { return; }
        var options = Array.prototype.slice.call(el.notePickerList.querySelectorAll('[role="option"]'));
        var at = options.indexOf(document.activeElement);
        var next = at;
        if (e.key === 'ArrowDown') { next = (at + 1) % options.length; }
        else if (e.key === 'ArrowUp') { next = (at - 1 + options.length) % options.length; }
        else if (e.key === 'Home') { next = 0; }
        else if (e.key === 'End') { next = options.length - 1; }
        else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (at >= 0) { chooseNote(Number(options[at].dataset.index)); }
            return;
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeNotePicker(true);
            return;
        } else { return; }
        e.preventDefault();
        if (options[next]) { options[next].focus(); }
    });
    el.addBtn.addEventListener('click', addNote);
    if (el.terminalBtn) {
        el.terminalBtn.addEventListener('click', function () {
            el.terminalBtn.setAttribute('aria-pressed', 'true');
            syncPinnedMenuActionStates();
            vscode.postMessage({ type: 'showTerminalCommands' });
        });
    }
    el.zoomOutBtn.addEventListener('click', function () { setFontSize(settings.fontSize - 1); });
    el.zoomInBtn.addEventListener('click', function () { setFontSize(settings.fontSize + 1); });
    el.pinBtn.addEventListener('click', togglePin);

    el.previewBtn.addEventListener('click', function () {
        setPreview(!previewMode);
        if (!previewMode) { el.noteInput.focus(); }
    });

    el.preview.addEventListener('change', function (e) {
        var t = e.target;
        if (!t || t.type !== 'checkbox') { return; }
        var n = currentNote();
        if (!n) { return; }
        var lines = n.content.split('\n');
        var idx = Number(t.getAttribute('data-line'));
        if (lines[idx] === undefined) { return; }
        lines[idx] = lines[idx].replace(/^(\s*[-*+] )\[([ xX])\]/, '$1' + (t.checked ? '[x]' : '[ ]'));
        setContentFromPreview(lines.join('\n'));
        renderPreview();
    });

    el.preview.addEventListener('click', function (e) {
        var button = e.target.closest('button.code-copy-button');
        if (!button) { return; }
        var code = button.parentElement.querySelector('code');
        if (!code) { return; }
        e.preventDefault();
        e.stopPropagation();
        vscode.postMessage({ type: 'copy', text: code.textContent || '' });
    });

    // Your hint: clicking the preview flashes the eye button to show how to edit
    el.preview.addEventListener('click', function (e) {
        document.body.classList.remove('compact-title-editing');
        var n = currentNote();
        if (!n || !n.content.trim()) {
            setPreview(false);
            el.noteInput.focus();
            return;
        }
        if (e.target.closest('input, a, button, img')) { return; }
        clearTimeout(previewClickTimeout);
        el.previewBtn.classList.add('warning-click');
        flash('Preview mode');
        previewClickTimeout = setTimeout(function () {
            el.previewBtn.classList.remove('warning-click');
        }, 1200);
    });

    el.preview.addEventListener('dblclick', function (e) {
        if (!previewMode || e.target.closest('input, a, button, img')) { return; }
        document.body.classList.remove('compact-title-editing');
        clearTimeout(previewClickTimeout);
        el.previewBtn.classList.remove('warning-click');
        setPreview(false);
        flash('Editing');
        el.noteInput.focus();
    });

    // Click an image in the preview to resize it
    el.preview.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) { return; }
        if (t.tagName === 'IMG' && t.hasAttribute('data-idx') && !t.closest('a')) {
            selectImage(t);
            return;
        }
        if (!t.closest('a') && t.type !== 'checkbox') { clearImageSelection(); }
    });
    el.preview.addEventListener('contextmenu', function (e) {
        var img = e.target && e.target.closest ? e.target.closest('img[data-line][data-idx]') : null;
        if (!img || img.closest('a')) { return; }
        e.preventDefault();
        openImageContextMenu(img, e.clientX, e.clientY);
    });
    var scrollbarHideTimers = new WeakMap();

    function showScrollbarWhileScrolling(target) {
        target.classList.add('is-scrolling');
        clearTimeout(scrollbarHideTimers.get(target));
        scrollbarHideTimers.set(target, setTimeout(function () {
            target.classList.remove('is-scrolling');
            scrollbarHideTimers.delete(target);
        }, 700));
    }

    function revealScrollbarWhileScrolling(target) {
        target.addEventListener('scroll', function () {
            showScrollbarWhileScrolling(target);
        }, { passive: true });
    }

    revealScrollbarWhileScrolling(el.noteInput);
    revealScrollbarWhileScrolling(el.preview);
    el.preview.addEventListener('scroll', function (e) {
        closeImageContextMenu();
        if (e.target && e.target.tagName === 'PRE') {
            showScrollbarWhileScrolling(e.target);
        }
    }, true);
    el.preview.addEventListener('scroll', positionImageTools);

    // A picture that cannot be loaded says which file is missing
    el.preview.addEventListener('error', function (e) {
        var t = e.target;
        if (!t || t.tagName !== 'IMG' || t.classList.contains('broken')) { return; }
        var name = String(t.getAttribute('src') || '').split('/').pop();
        t.classList.add('broken');
        t.setAttribute('alt', 'Image not found: ' + name);
        t.setAttribute('title', 'Could not load ' + name);
    }, true);
    window.addEventListener('resize', positionImageTools);

    el.imgBar.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-size]') : null;
        if (!b || !selectedImage) { return; }
        var avail = availableImageWidth();
        var sizes = { small: Math.round(avail / 3), medium: Math.round(avail * 2 / 3), large: avail, original: 0 };
        commitImageWidth(sizes[b.getAttribute('data-size')] || 0);
    });

    el.imgHandle.addEventListener('pointerdown', function (e) {
        var img = findSelectedImg();
        if (!img) { return; }
        e.preventDefault();
        var handle = el.imgHandle;
        var startX = e.clientX;
        var startW = img.getBoundingClientRect().width;
        var maxW = availableImageWidth();
        var current = Math.round(startW);
        handle.setPointerCapture(e.pointerId);
        function move(ev) {
            current = Math.max(24, Math.min(maxW, Math.round(startW + ev.clientX - startX)));
            img.setAttribute('width', String(current));
            positionImageTools();
        }
        function up() {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
            if (current !== Math.round(startW)) { commitImageWidth(current); }
        }
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
    });

    el.menuBtn.addEventListener('click', function () {
        if (menuOpen) { closeMenu(); } else { openMenu(); }
    });

    el.menu.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') { return; }
        e.preventDefault();
        var items = Array.prototype.slice.call(el.menu.querySelectorAll('.menu-layout-toggle, .menu-item:not(:disabled), .menu-close'));
        var at = items.indexOf(document.activeElement);
        var next = e.key === 'ArrowDown' ? at + 1 : at - 1;
        if (next < 0) { next = items.length - 1; }
        if (next >= items.length) { next = 0; }
        if (items[next]) { items[next].focus(); }
    });

    document.addEventListener('mousedown', function (e) {
        var editingContent = e.target === el.noteInput || el.previewBtn.contains(e.target) || el.preview.contains(e.target);
        var iconOnlyMenu = el.menu.classList.contains('icons-only') ||
            (menuLayout === 'auto' && el.menu.offsetWidth <= 52);
        if (menuOpen && !el.menu.contains(e.target) && !el.menuBtn.contains(e.target) &&
            !el.toolbarContextMenu.contains(e.target) &&
            !(editingContent && iconOnlyMenu)) { closeMenu(); }
        if (!el.toolbarContextMenu.hidden && !el.toolbarContextMenu.contains(e.target)) { closeToolbarContextMenu(); }
        if (!el.notePicker.hidden && !el.noteSelectBtn.parentElement.contains(e.target) &&
            !el.notePicker.contains(e.target)) { closeNotePicker(false); }
        if (!imageContextMenu.hidden && !imageContextMenu.contains(e.target)) { closeImageContextMenu(); }
    });

    document.addEventListener('keydown', function (e) {
        if (!imageContextMenu.hidden && e.key === 'Escape') {
            e.preventDefault();
            closeImageContextMenu();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            var target = e.target;
            var typingInInput = target !== el.noteInput && target && target.closest &&
                target.closest('input, select, [contenteditable="true"]');
            if (!typingInInput) {
                if (e.key === '+' || e.key === '=') {
                    e.preventDefault();
                    setFontSize(settings.fontSize + 1);
                    return;
                }
                if (e.key === '-' || e.key === '_') {
                    e.preventDefault();
                    setFontSize(settings.fontSize - 1);
                    return;
                }
                if (e.key === '0') {
                    e.preventDefault();
                    setFontSize(13);
                    return;
                }
            }
        }
        if (e.key !== 'Escape') { return; }
        if (!el.notePicker.hidden) { closeNotePicker(true); }
        else if (menuOpen) { closeMenu(); el.menuBtn.focus(); }
        else if (panelMode) { closePanel(); }
        else if (selectedImage) { clearImageSelection(); }
    });

    el.searchBtn.addEventListener('click', function () {
        if (panelMode === 'search') { closePanel(); } else { openPanel('search'); }
    });
    el.panelClose.addEventListener('click', closePanel);
    el.panelInput.addEventListener('input', function () {
        activeResult = 0;
        el.panelClear.hidden = !el.panelInput.value;
        renderPanel();
    });
    el.panelClear.addEventListener('click', function () {
        el.panelInput.value = '';
        el.panelClear.hidden = true;
        activeResult = 0;
        renderPanel();
        el.panelInput.focus();
    });
    el.panelInput.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!visibleResults.length) { return; }
            activeResult = (activeResult + (e.key === 'ArrowDown' ? 1 : -1) + visibleResults.length) % visibleResults.length;
            renderPanel();
            var active = el.panelList.querySelector('.result.active');
            if (active && active.scrollIntoView) { active.scrollIntoView({ block: 'nearest' }); }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            openResult(activeResult);
        }
    });
    el.panelAction.addEventListener('click', function () {
        armConfirm(el.panelAction, 'Empty trash', 'Sure?', function () {
            trash = [];
            persist();
            renderPanel();
            flash('Trash emptied');
        });
    });

    el.undoBtn.addEventListener('click', undoDelete);

    el.linkRow.addEventListener('click', function (event) {
        var button = event.target.closest('[data-link-action]');
        var n = currentNote();
        var index = button ? Number(button.dataset.linkIndex) : -1;
        var links = noteLinks(n);
        var link = links[index];
        if (!link) { return; }
        if (button.dataset.linkAction === 'open') {
            vscode.postMessage({ type: 'openLink', path: link.path, line: link.line });
        } else if (button.dataset.linkAction === 'remove') {
            links.splice(index, 1);
            setNoteLinks(n, links);
            commitMeta();
        }
    });

    /* ---------- Messages from the extension ---------- */

    function runCommand(name) {
        if (name === 'new') { addNote(); }
        else if (name === 'next') { moveSelection(1); }
        else if (name === 'prev') { moveSelection(-1); }
        else if (name === 'search') { openPanel('search'); }
    }

    function applyLoad(msg, restoreState) {
        window.__notesReady = true;
        setImageBase(msg.imagesBase);
        pages = Array.isArray(msg.pages) ? msg.pages : [];
        trash = Array.isArray(msg.trash) ? msg.trash : [];
        scope = msg.scope === 'workspace' ? 'workspace' : 'global';
        hasWorkspace = !!msg.hasWorkspace;
        applySettings(msg.settings);

        if (restoreState) {
            var saved = vscode.getState() || {};
            if (saved.menuLayout === 'icons' || saved.menuLayout === 'labels') { menuLayout = saved.menuLayout; }
            toolbarPinned = saved.toolbarPinsVersion === 2 && Array.isArray(saved.toolbarPinned)
                ? saved.toolbarPinned.filter(function (id) {
                    return ['searchBtn', 'terminalBtn', 'pinBtn', 'previewBtn'].indexOf(id) !== -1 ||
                        (typeof id === 'string' && /^menu:[a-z0-9-]+$/.test(id));
                })
                : ['addBtn', 'previewBtn'].concat(
                    Array.isArray(saved.toolbarPinned)
                        ? saved.toolbarPinned.filter(function (id) {
                            return ['searchBtn', 'terminalBtn', 'pinBtn'].indexOf(id) !== -1;
                        })
                        : []
                );
            if (saved.currentId) { currentId = saved.currentId; }
            var untouchedDraft = pages.find(function (note) { return note.id === saved.untouchedNewNoteId; });
            untouchedNewNoteId = untouchedDraft && isBlankNote(untouchedDraft) ? untouchedDraft.id : null;
            newNoteMenuId = pages.some(function (note) { return note.id === saved.newNoteMenuId; })
                ? saved.newNoteMenuId
                : null;
        } else {
            untouchedNewNoteId = null;
            newNoteMenuId = null;
        }
        ensureCurrent();
        applyToolbarPins();
        notifyCurrentNoteChanged();
        clearImageSelection();
        applyPreview(!!currentNote().preview);
        loadNoteIntoInputs();
        renderChrome();
        if (restoreState) { animateTitleOnOpen(); }
        closePanel();
        closeMenu();
        saveViewState();
    }

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { animateTitleOnOpen(); }
    });
    el.titleInput.addEventListener('animationend', function (event) {
        if (event.animationName === 'title-open-reveal') {
            el.titleInput.classList.remove('title-open-animation');
        }
    });

    window.addEventListener('message', function (event) {
        var msg = event.data || {};
        switch (msg.type) {
            case 'init': applyLoad(msg, true); break;
            case 'load': applyLoad(msg, false); break;
            case 'activityStatus':
                if (typeof msg.status === 'string') {
                    setFooterActivityStatus(msg.status, msg.duration);
                }
                break;
            case 'imageSyncProgress':
                if (typeof msg.completed === 'number' && typeof msg.total === 'number') {
                    setBackgroundStatus('Restoring saved images (' + msg.completed + ' of ' + msg.total + ')...', false);
                }
                break;
            case 'imageSyncComplete':
                if (typeof msg.failedCount === 'number' && msg.failedCount > 0) {
                    setBackgroundStatus('Could not restore ' + msg.failedCount + ' saved image' + (msg.failedCount === 1 ? '' : 's') + '.', true);
                } else {
                    setBackgroundStatus('', false);
                }
                if (!el.preview.hidden) { renderPreview(); }
                break;
            case 'imageSyncFailed':
                setBackgroundStatus('Could not finish restoring saved images.', true);
                break;
            case 'copyComplete':
                [menuToolbarActions['menu:copy-note'] && menuToolbarActions['menu:copy-note'].button]
                    .concat(Array.prototype.slice.call(el.pinnedMenuActions.querySelectorAll('[data-toolbar-pin-id="menu:copy-note"]')))
                    .filter(Boolean)
                    .forEach(function (button) {
                        button.classList.add('copy-confirmed');
                    });
                flash('Copied');
                break;
            case 'copyFailed':
                flash('Could not copy');
                break;
            case 'imageCutMarkdownCopied':
                if (pendingImageCut && msg.requestId === pendingImageCut.id) {
                    var copiedCut = pendingImageCut;
                    pendingImageCut = null;
                    if (removeSelectedImage(copiedCut.target)) { flash('Image cut as Markdown'); }
                    else { flash('Markdown copied, but could not remove the image from the note'); }
                }
                break;
            case 'imageCutMarkdownFailed':
                if (pendingImageCut && msg.requestId === pendingImageCut.id) {
                    pendingImageCut = null;
                    flash('Could not cut the image because clipboard access failed');
                }
                break;
            case 'settings': applySettings(msg.settings); break;
            case 'menuActionComplete':
                if (msg.actionId === lastInvokedMenuActionId) {
                    lastInvokedMenuActionId = null;
                }
                if (msg.actionId === 'terminalBtn' && el.terminalBtn) {
                    el.terminalBtn.setAttribute('aria-pressed', 'false');
                }
                syncPinnedMenuActionStates();
                break;
            case 'command': runCommand(msg.name); break;
            case 'insertSelection': insertSelection(msg); break;
            case 'insertTerminalCommand': insertTerminalCommand(msg); break;
            case 'linkAttached':
                var n = currentNote();
                if (n && msg.link) {
                    var previousCount = noteLinks(n).length;
                    addNoteLink(n, msg.link);
                    if (noteLinks(n).length > previousCount) {
                        commitMeta();
                        flash('Linked to ' + msg.link.label);
                    } else {
                        flash('File is already attached');
                    }
                }
                break;
            case 'imageSaved':
                insertImageMarkdown(String(msg.file));
                if (msg.pasted === true) { flash('Pasted'); }
                break;
            case 'processImage': processImageData(String(msg.data)); break;
            case 'toast': flash(String(msg.text || '')); break;
        }
    });

    window.notesApi = {
        get: function (id) { return pages.find(function (note) { return note.id === id; }) || null; },
        getCurrent: currentNote,
        select: showNote,
        post: function (message) { vscode.postMessage(message); },
        flash: flash,
        update: function (id, changes) {
            persistIfPending();
            var note = pages.find(function (item) { return item.id === id; });
            if (!note) { return false; }
            if (currentId === id) { markCurrentNoteTouched(); }
            if (typeof changes.title === 'string') { note.title = changes.title || 'Untitled'; }
            if (typeof changes.content === 'string') { note.content = changes.content; }
            note.updated = Date.now();
            if (currentId === id) {
                el.titleInput.value = note.title;
                el.noteInput.value = note.content;
                if (!el.preview.hidden) { renderPreview(); }
            }
            renderChrome();
            markDirty();
            return true;
        },
        addNote: function (title, content) {
            persistIfPending();
            var note = makeNote(title || 'Untitled');
            note.title = title || 'Untitled';
            note.content = content || '';
            pages.push(note);
            currentId = note.id;
            notifyCurrentNoteChanged();
            setPreview(false);
            loadNoteIntoInputs();
            renderChrome();
            saveViewState();
            persist();
            return note;
        }
    };

    setInterval(renderFooter, 30000);

    vscode.postMessage({ type: 'ready' });
})();
