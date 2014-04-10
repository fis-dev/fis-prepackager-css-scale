var CssFilter;
var NodeImage = require('images');
var caches = {};

function findFileInArray( path, lookup, opt ) {
    var target;

    fis.util.map( lookup, function( subpath, file ) {
        if ( file.getUrl( opt.hash, opt.domain ) == path ) {
            target = file;
            return true;
        }
    });

    return target;
}

CssFilter = Object.derive(function( file, scale, ret, opt ) {
    var key;

    if ( typeof file === 'string' ) {
        this.content = file;
    } else {
        this.file = file;
        this.content = file.getContent();
    }

    this.scale = scale;
    this.ret = ret;
    this.opt = opt;

    key = fis.util.md5( this.content );

    // check cache first.
    if ( key && caches[ key ] ) {
        this.content = caches[ key ];
    } else {
        this.content = this._process( this.content );
        caches[ key ] = this.content;
    }

}, {

    _process: function( content ) {
        var rRuler = /[^{}]+{([^{}]*?(?:background|background-image)\s*\:[^;}]*?url\(('|")?(.*?)\2\)[^{}]*?)}/ig;
        var rNoScale = /(\?|&amp;|&)__noscale($|&amp;|&)/i;
        var rBas64 = /^data\:([^;]+?);base64,(.*?)$/i;

        // 只认px的。
        var rBgSize = /\s*[-\w]*background-size\s*\:\s*([\d\.]+)px\s+([\d\.]+)px\s*(;|$)/img;
        var me = this;

        content = content.replace( rRuler, function( ruler, body, _, value ) {
            var info, file, img, imgResized, ext, buf, m, type, prefix;
            var mSize, w, h, ow, oh, indent, white;

            // 如果明确指定不缩放，则跳过此图片。
            if ( rNoScale.test( value ) ) {
                return ruler.replace( value, value.replace( rNoScale, '$1$2').replace(/(?:\?|&amp;|&)$/i, '' ) );
            }

            m = rBas64.exec( value );

            // 如果是base64
            if ( m ) {
                buf = new Buffer( m[2], 'base64' );
                type = /^image\/(.*?)$/i.test( m[ 1 ] ) && RegExp.$1;
                type = '.' + (type || 'png');
                img = new NodeImage( buf );
                ow = img.width();
                oh = img.height();
                img.resize( img.width() * me.scale );
                buf = img.encode( type );
                prefix = 'data:' + fis.util.getMimeType( type ) + ';base64,';
                ruler = ruler.replace( value, prefix + fis.util.base64(buf) );
            } else {
                info = fis.uri( value, me.file ? me.file.dirname : '' );
                file = findFileInArray( info.rest, me.ret.src, me.opt );

                if ( !file ) {
                    fis.log.error( info.rest + ' not found!' );
                    return ruler;
                }

                img = new NodeImage( file.getContent() );
                ow = img.width();
                oh = img.height();
                img.resize( img.width() * me.scale );

                ext = '_' + me.scale + 'x' + file.rExt;
                imgResized = fis.file.wrap( file.realpathNoExt + ext );
                imgResized.setContent( img.encode( file.rExt ) );
                me.ret.pkg[ imgResized.subpath ] = imgResized;
                me.ret.src[ imgResized.subpath ] = imgResized;

                ruler = ruler.replace(/url\(('|")?.*?\1\)/ig, function( _, quote ) {
                    quote = quote || '';
                    return 'url(' + quote + me.getFileUrl( imgResized, info ) +  quote + ')';
                });
            }

            w = img.width();
            h = img.height();

            mSize = rBgSize.exec( ruler );
            if ( mSize ) {
                ruler = ruler.replace( rBgSize, function( _, width, height ) {
                    var scaleX, scaleY;

                    width = parseFloat( width );
                    height = parseFloat( height );

                    if ( Math.abs( Math.round( width - w ) ) < 2 &&
                        Math.abs( Math.round( height - h ) ) < 2 ) {
                        return '';
                    }

                    return _;
                });
            } else {
                indent = /(?:\n|(?:\r\n)|\r)(\s+)[\w\-]/m.exec( ruler );
                indent = indent ? indent[1].length : 4;
                white = '';
                while ( indent-- ) {
                    white += ' ';
                }


                ruler = ruler.replace( /}/, function() {
                    return white + 'background-size: ' + ow + 'px ' + oh + 'px;\n}';
                });
            }

            return ruler;
        });

        return content;
    },

    getFileUrl: function( file, info ) {
        var url, hash, query;

        url = file.getUrl( this.opt.hash, this.opt.domain );
        hash = info.hash || file.hash || '';
        query = info.query || file.query || '';

        return url + query + hash;
    },

    getContent: function() {
        return this.content;
    },

    createFile: function( path ) {
        var dst;

        if ( !path && this.file ) {
            path = this.file.realpathNoExt + '_' +
                    this.scale + 'x' + this.file.rExt;
        }

        if ( !path ) {
            throw new Error( 'arguments error in CssFilter::createFile!' );
        }

        dst = fis.file.wrap( path );
        dst.setContent( this.content );

        this.ret.pkg[ dst.subpath ] = dst;
        this.ret.src[ dst.subpath ] = dst;

        return dst;
    }
});

module.exports = CssFilter.factory();
module.exports.caches = caches;