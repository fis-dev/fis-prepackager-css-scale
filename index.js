var rulers, fileMap, fileIdMap, ld, rd, opt;
var PLACEHOLDER = '__placeHolder__';
var PLACEHOLDER_REG = new RegExp( PLACEHOLDER +
        '(?:\\s*x\\s*([\\d\\.]+))?', 'ig');
var cssFilter = require('./lib/cssFilter.js');

var map = (function() {
    var delimiter = "\x19";
    var id = 0;

    return {
        reg: /\x19start(\d+)\x19([^\x19]*?)\x19([^\x19]*?)\x19([^\x19]*?)\x19end\1\x19/ig,

        wrap: function( type, filepath, content ) {
            return delimiter + 'start' + (++id) + delimiter + type + delimiter +
                    filepath + delimiter + content + delimiter +
                    'end' + id + delimiter;
        }
    };
})();

function getFileInfoByPath( path ) {
    var info = fis.uri( path );
    var pos = info.rest.indexOf(':');
    var ns = ~pos ? info.rest.substring( 0, pos ) : '';
    var file;

    // 如果路径是带namespace的，可能用户会写错
    // 出现这种case: namespace:/path/xxx.xxx
    // 应该是: namespace:path/xxx.xxx
    if ( ns ) {
        info.rest = info.rest.replace( new RegExp( '(' +
                fis.util.escapeReg( ns ) + ':)/', 'ig' ), '$1' );
    }

    info.file = info.file || (ns ? fileIdMap[ info.rest ] :
            (fileMap[ info.rest ] || findFileInArray( info.rest, fileMap )));

    return info;
}

function findFileInArray( path, lookup ) {
    var target;

    fis.util.map( lookup, function( subpath, file ) {
        if ( file.getUrl( opt.hash, opt.domain ) == path ) {
            target = file;
            return true;
        }
    });

    return target;
}

function hit( path ) {
    var list = rulers,
        i = 0,
        len = list && list.length,
        ruler;

    for ( ; i < len; i++ ) {
        ruler = list[ i ];

        if ( fis.util.filter( path, ruler.include, ruler.exclude ) ) {
            return ruler;
        }
    }

    return false;
}

function parserCss( content, file ) {
    var reg = /(\/\*[\s\S]*?(?:\*\/|$))|((?:@import\s+)url\(\s*('|\")?(.*?)\3\)\s*(?:;|$))/g;
    return content.replace( reg, function( _, comment, url, quote, value ) {
        if ( comment ) {
            return _;
        }

        quote = quote || '';
        _ = '@import url(' + quote + PLACEHOLDER + quote + ');';

        return map.wrap( 'uri', value, _ );
    });
}

function parserHtml( content, file ) {
    var escapedLd = fis.util.escapeReg( ld );
    var escapedRd = fis.util.escapeReg( rd );

    // 匹配style
    var rStyle = '(?:<style[^>]*?>([\\s\\S]*?)<\\/style\\s*>)';

    // 匹配{%style%}{%/style%}
    var rStyle2 = '(?:' + escapedLd + 'style[^>]*?' + escapedRd +
            '([\\s\\S]*?)' + escapedLd + '\\/style\\s*' + escapedRd + ')';

    // 匹配link
    var rLink = '(?:<(link)\\s+[\\s\\S]*?>)';

    // html 注释
    var rComment = '(<\\!--[\\s\\S]*?(?:-->|$))';

    // smarty注释
    var rComment2 = '(' + escapedLd + '\\*[\\s\\S]*?(?:\\*' + escapedRd +'|$))';

    // 匹配href
    var rHref = /(\s*(?:data-)?href\s*=\s*)('|")(.*?)\2/ig;

    var rName = /(\s*name\s*=\s*)('|")(.*?)\2/ig;

    var rRequire = '(?:' + escapedLd + 'require\\s+([\\s\\S]*?)' + escapedRd+ ')'


    var reg  = new RegExp([ rComment, rComment2, rStyle, rStyle2, rLink, rRequire ].join('|'), 'gi' );

    return content.replace( reg, function( all, c1, c2, s1, s2, link, require ) {
        var inline = '',
            value, ref, isCssLink;

        // 忽略注释
        if ( c1 || c2 ) {
            return all;
        } else if ( s1 || s2 ) {
            return map.wrap( 'embed', file.subpath, parserCss( all, file ) );
        } else if ( link ) {

            // 不判断了，肯定是link
            ref = /\s+rel\s*=\s*('|")(.*?)\1/i.exec( all );
            ref = ref && ref[ 2 ].toLowerCase();

            isCssLink = ref === 'stylesheet';

            if ( !isCssLink && ref !== 'import' || !rHref.test( all ) ) {
                return all;
            }

            all = all.replace( rHref, function( _, prefix, quote, _value ) {
                value = _value;
                return prefix + quote + PLACEHOLDER + quote;
            });

            return map.wrap( 'uri', value, all );
        } else if ( require ) {

            // {%require name="xxx"%}
            all = all.replace( rName, function( _, prefix, quote, _value ) {
                value = _value;
                return prefix + quote + PLACEHOLDER + quote;
            });

            return map.wrap( 'uri', value, all );
        }

        return inline || all;
    });
}

function regReplace( content, reg, callback ) {
    while ( reg.exec( content ) ) {
        content = content.replace( reg, callback );
    }
    return content;
}

function _process( file, ret ) {
    var content;

    if ( /*!file.isCssLike &&*/ !file.isHtmlLike ) {
        return;
    }

    content = file.getContent();
    content = file.isCssLike ? parserCss( content, file ) :
            parserHtml( content, file );


    content = regReplace( content, map.reg, function( _, id, type, pathinfo, all ) {
        var info = getFileInfoByPath( pathinfo );
        var ruler, tpl;

        if ( !info.file ||
                !(ruler = hit( info.file.subpath )) ||
                type === 'uri' && file.subpath === info.file.subpath ) {
            return all.replace( PLACEHOLDER_REG, pathinfo );
        }

        tpl = ruler.tpl.replace( PLACEHOLDER_REG, function( _, scale ) {
            var filter, dst, value, hash, file, ext, indent, white;

            scale = scale ? parseFloat( scale ) : 1;

            if ( type === 'uri' ) {
                file = info.file;

                if ( ~~scale === 1 ) {
                    dst = file;
                } else {
                    filter = new cssFilter( file, scale, ret, opt );
                    dst = filter.createFile();
                }

                if ( ~pathinfo.indexOf(':') ) {
                    value = dst.getId();
                } else {
                    value = dst.getUrl( opt.hash, opt.domain );
                    hash = dst.hash;
                    value += info.query + hash;
                }

                return all.replace( PLACEHOLDER_REG, value );
            } else if ( type === 'embed' ) {


                if ( ~~scale === 1 ) {
                    value = all;
                } else {
                    ext = '_' + Date.now() + info.file.rExt;
                    file = fis.file.wrap( info.file.realpathNoExt + ext );
                    file.setContent( all );
                    filter = new cssFilter( file, scale, ret, opt );
                    value = filter.getContent();
                }

                // indent = /(?:\n|(?:\r\n)|\r)(\s+)[\w\-]/m.exec( value );
                // indent = indent ? indent[1].length : 4;
                // white = '';
                // while ( indent-- ) {
                //     white += ' ';
                // }
                white = white ? '\n' + white : '';

                return white + value + white;
            }

            return pathinfo;
        });

        return tpl;
    });

    file.setContent( content );
}

module.exports = function( ret, conf, settings, _opt ) {

    ld = settings.left_delimiter || fis.config.get('settings.smarty.left_delimiter') || '{%';
    rd = settings.right_delimiter || fis.config.get('settings.smarty.right_delimiter') || '%}';

    if ( !Array.isArray( settings ) ) {
        settings = [ settings ];
    }

    settings.forEach(function( ruler ) {
        ruler.condition = ruler.condition || '$condition';
        if ( !ruler.tpl && ruler.condition ) {
            ruler.tpl = ld + 'if ' + ruler.condition + rd + PLACEHOLDER +
                    ld + 'else' + rd + PLACEHOLDER + 'x0.5' + ld + '/if' + rd;
        }
    });

    rulers = settings;
    fileMap = ret.src;
    fileIdMap = ret.ids;
    opt = _opt;

    fis.util.map( ret.src, function( subpath, file ) {
        _process( file, ret );
    });

    rulers = fileMap = fileIdMap = opt = null;
}