require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"buffer":[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Find the length
  var length
  if (type === 'number')
    length = subject > 0 ? subject >>> 0 : 0
  else if (type === 'string') {
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) { // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data))
      subject = subject.data
    length = +subject.length > 0 ? Math.floor(+subject.length) : 0
  } else
    throw new TypeError('must start with number, buffer, array or string')

  if (length > kMaxLength)
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
      'size: 0x' + kMaxLength.toString(16) + ' bytes')

  var buf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++)
        buf[i] = subject.readUInt8(i)
    } else {
      for (i = 0; i < length; i++)
        buf[i] = ((subject[i] % 256) + 256) % 256
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  if (length > 0 && length <= Buffer.poolSize)
    buf.parent = rootParent

  return buf
}

function SlowBuffer(subject, encoding, noZero) {
  if (!(this instanceof SlowBuffer))
    return new SlowBuffer(subject, encoding, noZero)

  var buf = new Buffer(subject, encoding, noZero)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b))
    throw new TypeError('Arguments must be Buffers')

  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function (list, totalLength) {
  if (!isArray(list)) throw new TypeError('Usage: Buffer.concat(list[, length])')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase)
          throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max)
      str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b)
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(byte)) throw new Error('Invalid hex string')
    buf[offset + i] = byte
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length, 2)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0

  if (length < 0 || offset < 0 || offset > this.length)
    throw new RangeError('attempt to write outside buffer bounds');

  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len;
    if (start < 0)
      start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0)
      end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start)
    end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length)
    newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0)
    throw new RangeError('offset is not uint')
  if (offset + ext > length)
    throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100))
    val += this[offset + i] * mul

  return val
}

Buffer.prototype.readUIntBE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100))
    val += this[offset + --byteLength] * mul;

  return val
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
      ((this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      this[offset + 3])
}

Buffer.prototype.readIntLE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100))
    val += this[offset + i] * mul
  mul *= 0x80

  if (val >= mul)
    val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100))
    val += this[offset + --i] * mul
  mul *= 0x80

  if (val >= mul)
    val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80))
    return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16) |
      (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
      (this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      (this[offset + 3])
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100))
    this[offset + i] = (value / mul) >>> 0 & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100))
    this[offset + i] = (value / mul) >>> 0 & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

Buffer.prototype.writeIntLE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(this,
             value,
             offset,
             byteLength,
             Math.pow(2, 8 * byteLength - 1) - 1,
             -Math.pow(2, 8 * byteLength - 1))
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100))
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(this,
             value,
             offset,
             byteLength,
             Math.pow(2, 8 * byteLength - 1) - 1,
             -Math.pow(2, 8 * byteLength - 1))
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100))
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (target_start >= target.length) target_start = target.length
  if (!target_start) target_start = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || source.length === 0) return 0

  // Fatal error conditions
  if (target_start < 0)
    throw new RangeError('targetStart out of bounds')
  if (start < 0 || start >= source.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes(string, units) {
  var codePoint, length = string.length
  var leadSurrogate = null
  units = units || Infinity
  var bytes = []
  var i = 0

  for (; i<length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {

      // last char was a lead
      if (leadSurrogate) {

        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        }

        // valid surrogate pair
        else {
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      }

      // no lead yet
      else {

        // unexpected trail
        if (codePoint > 0xDBFF) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // unpaired lead
        else if (i + 1 === length) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        else {
          leadSurrogate = codePoint
          continue
        }
      }
    }

    // valid bmp char, but last char was a lead
    else if (leadSurrogate) {
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    }
    else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      );
    }
    else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      );
    }
    else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      );
    }
    else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {

    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length, unitSize) {
  if (unitSize) length -= length % unitSize;
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":3,"ieee754":4,"is-array":5}],1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
arguments[4][1][0].apply(exports,arguments)
},{"dup":1}],3:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],4:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],5:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],6:[function(require,module,exports){
'use strict';

exports.randomBytes = exports.rng = exports.pseudoRandomBytes = exports.prng = require('randombytes')

exports.createHash = exports.Hash = require('create-hash')

exports.createHmac = exports.Hmac = require('create-hmac')

var hashes = ['sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'md5', 'rmd160'].concat(Object.keys(require('browserify-sign/algos')))
exports.getHashes = function () {
  return hashes;
}

var p = require('pbkdf2-compat')
exports.pbkdf2 = p.pbkdf2
exports.pbkdf2Sync = p.pbkdf2Sync

var aes = require('browserify-aes');
[
  'Cipher',
  'createCipher',
  'Cipheriv',
  'createCipheriv',
  'Decipher',
  'createDecipher',
  'Decipheriv',
  'createDecipheriv',
  'getCiphers',
  'listCiphers'
].forEach(function (key) {
  exports[key] = aes[key];
})

var dh = require('diffie-hellman');
[
  'DiffieHellmanGroup',
  'createDiffieHellmanGroup',
  'getDiffieHellman',
  'createDiffieHellman',
  'DiffieHellman'
].forEach(function (key) {
  exports[key] = dh[key];
})

require('browserify-sign/inject')(module.exports, exports);
require('create-ecdh/inject')(module.exports, exports);
require('public-encrypt/inject')(module.exports, exports);

// the least I can do is make error messages for the rest of the node.js/crypto api.
[
  'createCredentials',
  'privateEncrypt',
  'publicDecrypt'
].forEach(function (name) {
  exports[name] = function () {
    throw new Error([
      'sorry, ' + name + ' is not implemented yet',
      'we accept pull requests',
      'https://github.com/crypto-browserify/crypto-browserify'
    ].join('\n'));
  }
})

},{"browserify-aes":10,"browserify-sign/algos":25,"browserify-sign/inject":26,"create-ecdh/inject":72,"create-hash":94,"create-hmac":105,"diffie-hellman":106,"pbkdf2-compat":113,"public-encrypt/inject":114,"randombytes":141}],7:[function(require,module,exports){
(function (Buffer){
var md5 = require('create-hash/md5');
module.exports = EVP_BytesToKey;
function EVP_BytesToKey(password, keyLen, ivLen) {
  if (!Buffer.isBuffer(password)) {
    password = new Buffer(password, 'binary');
  }
  keyLen = keyLen/8;
  ivLen = ivLen || 0;
  var ki = 0;
  var ii = 0;
  var key = new Buffer(keyLen);
  var iv = new Buffer(ivLen);
  var addmd = 0;
  var md_buf;
  var i;
  var bufs =  [];
  while (true) {
    if(addmd++ > 0) {
       bufs.push(md_buf);
    }
    bufs.push(password);
    md_buf = md5(Buffer.concat(bufs));
    bufs = [];
    i = 0;
    if(keyLen > 0) {
      while(true) {
        if(keyLen === 0) {
          break;
        }
        if(i === md_buf.length) {
          break;
        }
        key[ki++] = md_buf[i];
        keyLen--;
        i++;
       }
    }
    if(ivLen > 0 && i !== md_buf.length) {
      while(true) {
        if(ivLen === 0) {
          break;
        }
        if(i === md_buf.length) {
          break;
        }
       iv[ii++] = md_buf[i];
       ivLen--;
       i++;
     }
   }
   if(keyLen === 0 && ivLen === 0) {
      break;
    }
  }
  for(i=0;i<md_buf.length;i++) {
    md_buf[i] = 0;
  }
  return {
    key: key,
    iv: iv
  };
}
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer","create-hash/md5":96}],8:[function(require,module,exports){
(function (Buffer){
// based on the aes implimentation in triple sec
// https://github.com/keybase/triplesec

// which is in turn based on the one from crypto-js
// https://code.google.com/p/crypto-js/

var uint_max = Math.pow(2, 32);
function fixup_uint32(x) {
    var ret, x_pos;
    ret = x > uint_max || x < 0 ? (x_pos = Math.abs(x) % uint_max, x < 0 ? uint_max - x_pos : x_pos) : x;
    return ret;
}
function scrub_vec(v) {
  var i, _i, _ref;
  for (i = _i = 0, _ref = v.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
    v[i] = 0;
  }
  return false;
}

function Global() {
  var i;
  this.SBOX = [];
  this.INV_SBOX = [];
  this.SUB_MIX = (function() {
    var _i, _results;
    _results = [];
    for (i = _i = 0; _i < 4; i = ++_i) {
      _results.push([]);
    }
    return _results;
  })();
  this.INV_SUB_MIX = (function() {
    var _i, _results;
    _results = [];
    for (i = _i = 0; _i < 4; i = ++_i) {
      _results.push([]);
    }
    return _results;
  })();
  this.init();
  this.RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
}

Global.prototype.init = function() {
  var d, i, sx, t, x, x2, x4, x8, xi, _i;
  d = (function() {
    var _i, _results;
    _results = [];
    for (i = _i = 0; _i < 256; i = ++_i) {
      if (i < 128) {
        _results.push(i << 1);
      } else {
        _results.push((i << 1) ^ 0x11b);
      }
    }
    return _results;
  })();
  x = 0;
  xi = 0;
  for (i = _i = 0; _i < 256; i = ++_i) {
    sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
    sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
    this.SBOX[x] = sx;
    this.INV_SBOX[sx] = x;
    x2 = d[x];
    x4 = d[x2];
    x8 = d[x4];
    t = (d[sx] * 0x101) ^ (sx * 0x1010100);
    this.SUB_MIX[0][x] = (t << 24) | (t >>> 8);
    this.SUB_MIX[1][x] = (t << 16) | (t >>> 16);
    this.SUB_MIX[2][x] = (t << 8) | (t >>> 24);
    this.SUB_MIX[3][x] = t;
    t = (x8 * 0x1010101) ^ (x4 * 0x10001) ^ (x2 * 0x101) ^ (x * 0x1010100);
    this.INV_SUB_MIX[0][sx] = (t << 24) | (t >>> 8);
    this.INV_SUB_MIX[1][sx] = (t << 16) | (t >>> 16);
    this.INV_SUB_MIX[2][sx] = (t << 8) | (t >>> 24);
    this.INV_SUB_MIX[3][sx] = t;
    if (x === 0) {
      x = xi = 1;
    } else {
      x = x2 ^ d[d[d[x8 ^ x2]]];
      xi ^= d[d[xi]];
    }
  }
  return true;
};

var G = new Global();


AES.blockSize = 4 * 4;

AES.prototype.blockSize = AES.blockSize;

AES.keySize = 256 / 8;

AES.prototype.keySize = AES.keySize;

 function bufferToArray(buf) {
  var len = buf.length/4;
  var out = new Array(len);
  var i = -1;
  while (++i < len) {
    out[i] = buf.readUInt32BE(i * 4);
  }
  return out;
 }
function AES(key) {
  this._key = bufferToArray(key);
  this._doReset();
}

AES.prototype._doReset = function() {
  var invKsRow, keySize, keyWords, ksRow, ksRows, t, _i, _j;
  keyWords = this._key;
  keySize = keyWords.length;
  this._nRounds = keySize + 6;
  ksRows = (this._nRounds + 1) * 4;
  this._keySchedule = [];
  for (ksRow = _i = 0; 0 <= ksRows ? _i < ksRows : _i > ksRows; ksRow = 0 <= ksRows ? ++_i : --_i) {
    this._keySchedule[ksRow] = ksRow < keySize ? keyWords[ksRow] : (t = this._keySchedule[ksRow - 1], (ksRow % keySize) === 0 ? (t = (t << 8) | (t >>> 24), t = (G.SBOX[t >>> 24] << 24) | (G.SBOX[(t >>> 16) & 0xff] << 16) | (G.SBOX[(t >>> 8) & 0xff] << 8) | G.SBOX[t & 0xff], t ^= G.RCON[(ksRow / keySize) | 0] << 24) : keySize > 6 && ksRow % keySize === 4 ? t = (G.SBOX[t >>> 24] << 24) | (G.SBOX[(t >>> 16) & 0xff] << 16) | (G.SBOX[(t >>> 8) & 0xff] << 8) | G.SBOX[t & 0xff] : void 0, this._keySchedule[ksRow - keySize] ^ t);
  }
  this._invKeySchedule = [];
  for (invKsRow = _j = 0; 0 <= ksRows ? _j < ksRows : _j > ksRows; invKsRow = 0 <= ksRows ? ++_j : --_j) {
    ksRow = ksRows - invKsRow;
    t = this._keySchedule[ksRow - (invKsRow % 4 ? 0 : 4)];
    this._invKeySchedule[invKsRow] = invKsRow < 4 || ksRow <= 4 ? t : G.INV_SUB_MIX[0][G.SBOX[t >>> 24]] ^ G.INV_SUB_MIX[1][G.SBOX[(t >>> 16) & 0xff]] ^ G.INV_SUB_MIX[2][G.SBOX[(t >>> 8) & 0xff]] ^ G.INV_SUB_MIX[3][G.SBOX[t & 0xff]];
  }
  return true;
};

AES.prototype.encryptBlock = function(M) {
  M = bufferToArray(new Buffer(M));
  var out = this._doCryptBlock(M, this._keySchedule, G.SUB_MIX, G.SBOX);
  var buf = new Buffer(16);
  buf.writeUInt32BE(out[0], 0);
  buf.writeUInt32BE(out[1], 4);
  buf.writeUInt32BE(out[2], 8);
  buf.writeUInt32BE(out[3], 12);
  return buf;
};

AES.prototype.decryptBlock = function(M) {
  M = bufferToArray(new Buffer(M));
  var temp = [M[3], M[1]];
  M[1] = temp[0];
  M[3] = temp[1];
  var out = this._doCryptBlock(M, this._invKeySchedule, G.INV_SUB_MIX, G.INV_SBOX);
  var buf = new Buffer(16);
  buf.writeUInt32BE(out[0], 0);
  buf.writeUInt32BE(out[3], 4);
  buf.writeUInt32BE(out[2], 8);
  buf.writeUInt32BE(out[1], 12);
  return buf;
};

AES.prototype.scrub = function() {
  scrub_vec(this._keySchedule);
  scrub_vec(this._invKeySchedule);
  scrub_vec(this._key);
};

AES.prototype._doCryptBlock = function(M, keySchedule, SUB_MIX, SBOX) {
  var ksRow, round, s0, s1, s2, s3, t0, t1, t2, t3, _i, _ref;

  s0 = M[0] ^ keySchedule[0];
  s1 = M[1] ^ keySchedule[1];
  s2 = M[2] ^ keySchedule[2];
  s3 = M[3] ^ keySchedule[3];
  ksRow = 4;
  for (round = _i = 1, _ref = this._nRounds; 1 <= _ref ? _i < _ref : _i > _ref; round = 1 <= _ref ? ++_i : --_i) {
    t0 = SUB_MIX[0][s0 >>> 24] ^ SUB_MIX[1][(s1 >>> 16) & 0xff] ^ SUB_MIX[2][(s2 >>> 8) & 0xff] ^ SUB_MIX[3][s3 & 0xff] ^ keySchedule[ksRow++];
    t1 = SUB_MIX[0][s1 >>> 24] ^ SUB_MIX[1][(s2 >>> 16) & 0xff] ^ SUB_MIX[2][(s3 >>> 8) & 0xff] ^ SUB_MIX[3][s0 & 0xff] ^ keySchedule[ksRow++];
    t2 = SUB_MIX[0][s2 >>> 24] ^ SUB_MIX[1][(s3 >>> 16) & 0xff] ^ SUB_MIX[2][(s0 >>> 8) & 0xff] ^ SUB_MIX[3][s1 & 0xff] ^ keySchedule[ksRow++];
    t3 = SUB_MIX[0][s3 >>> 24] ^ SUB_MIX[1][(s0 >>> 16) & 0xff] ^ SUB_MIX[2][(s1 >>> 8) & 0xff] ^ SUB_MIX[3][s2 & 0xff] ^ keySchedule[ksRow++];
    s0 = t0;
    s1 = t1;
    s2 = t2;
    s3 = t3;
  }
  t0 = ((SBOX[s0 >>> 24] << 24) | (SBOX[(s1 >>> 16) & 0xff] << 16) | (SBOX[(s2 >>> 8) & 0xff] << 8) | SBOX[s3 & 0xff]) ^ keySchedule[ksRow++];
  t1 = ((SBOX[s1 >>> 24] << 24) | (SBOX[(s2 >>> 16) & 0xff] << 16) | (SBOX[(s3 >>> 8) & 0xff] << 8) | SBOX[s0 & 0xff]) ^ keySchedule[ksRow++];
  t2 = ((SBOX[s2 >>> 24] << 24) | (SBOX[(s3 >>> 16) & 0xff] << 16) | (SBOX[(s0 >>> 8) & 0xff] << 8) | SBOX[s1 & 0xff]) ^ keySchedule[ksRow++];
  t3 = ((SBOX[s3 >>> 24] << 24) | (SBOX[(s0 >>> 16) & 0xff] << 16) | (SBOX[(s1 >>> 8) & 0xff] << 8) | SBOX[s2 & 0xff]) ^ keySchedule[ksRow++];
  return [
    fixup_uint32(t0),
    fixup_uint32(t1),
    fixup_uint32(t2),
    fixup_uint32(t3)
  ];

};




  exports.AES = AES;
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],9:[function(require,module,exports){
(function (Buffer){
var aes = require('./aes');
var Transform = require('./cipherBase');
var inherits = require('inherits');
var GHASH = require('./ghash');
var xor = require('./xor');
inherits(StreamCipher, Transform);
module.exports = StreamCipher;

function StreamCipher(mode, key, iv, decrypt) {
  if (!(this instanceof StreamCipher)) {
    return new StreamCipher(mode, key, iv);
  }
  Transform.call(this);
  this._finID = Buffer.concat([iv, new Buffer([0, 0, 0, 1])]);
  iv = Buffer.concat([iv, new Buffer([0, 0, 0, 2])]);
  this._cipher = new aes.AES(key);
  this._prev = new Buffer(iv.length);
  this._cache = new Buffer('');
  this._secCache = new Buffer('');
  this._decrypt = decrypt;
  this._alen = 0;
  this._len = 0;
  iv.copy(this._prev);
  this._mode = mode;
  var h = new Buffer(4);
  h.fill(0);
  this._ghash = new GHASH(this._cipher.encryptBlock(h));
  this._authTag = null;
  this._called = false;
}
StreamCipher.prototype._update = function (chunk) {
  if (!this._called && this._alen) {
    var rump = 16 - (this._alen % 16);
    if (rump <16) {
      rump = new Buffer(rump);
      rump.fill(0);
      this._ghash.update(rump);
    }
  }
  this._called = true;
  var out = this._mode.encrypt(this, chunk);
  if (this._decrypt) {
    this._ghash.update(chunk);
  } else {
    this._ghash.update(out);
  }
  this._len += chunk.length;
  return out;
};
StreamCipher.prototype._final = function () {
  if (this._decrypt && !this._authTag) {
    throw new Error('Unsupported state or unable to authenticate data');
  }
  var tag = xor(this._ghash.final(this._alen * 8, this._len * 8), this._cipher.encryptBlock(this._finID));
  if (this._decrypt) {
    if (xorTest(tag, this._authTag)) {
      throw new Error('Unsupported state or unable to authenticate data');
    }
  } else {
    this._authTag = tag;
  }
  this._cipher.scrub();
};
StreamCipher.prototype.getAuthTag = function getAuthTag () {
  if (!this._decrypt && Buffer.isBuffer(this._authTag)) {
    return this._authTag;
  } else {
    throw new Error('Attempting to get auth tag in unsupported state');
  }
};
StreamCipher.prototype.setAuthTag = function setAuthTag (tag) {
  if (this._decrypt) {
    this._authTag = tag;
  } else {
    throw new Error('Attempting to set auth tag in unsupported state');
  }
};
StreamCipher.prototype.setAAD = function setAAD (buf) {
  if (!this._called) {
    this._ghash.update(buf);
    this._alen += buf.length;
  } else {
    throw new Error('Attempting to set AAD in unsupported state');
  }
};
function xorTest(a, b) {
  var out = 0;
  if (a.length !== b.length) {
    out++;
  }
  var len = Math.min(a.length, b.length);
  var i = -1;
  while (++i < len) {
    out += (a[i] ^ b[i]);
  }
  return out;
}



}).call(this,require("buffer").Buffer)
},{"./aes":8,"./cipherBase":11,"./ghash":14,"./xor":24,"buffer":"buffer","inherits":143}],10:[function(require,module,exports){
var ciphers = require('./encrypter');
exports.createCipher = exports.Cipher = ciphers.createCipher;
exports.createCipheriv = exports.Cipheriv = ciphers.createCipheriv;
var deciphers = require('./decrypter');
exports.createDecipher = exports.Decipher = deciphers.createDecipher;
exports.createDecipheriv = exports.Decipheriv = deciphers.createDecipheriv;
var modes = require('./modes');
function getCiphers () {
  return Object.keys(modes);
}
exports.listCiphers = exports.getCiphers = getCiphers;

},{"./decrypter":12,"./encrypter":13,"./modes":15}],11:[function(require,module,exports){
(function (Buffer){
var Transform = require('stream').Transform;
var inherits = require('inherits');

module.exports = CipherBase;
inherits(CipherBase, Transform);
function CipherBase() {
  Transform.call(this);
}
CipherBase.prototype.update = function (data, inputEnc, outputEnc) {
  if (typeof data === 'string') {
    data = new Buffer(data, inputEnc);
  }
  var outData = this._update(data);
  if (outputEnc) {
    outData = outData.toString(outputEnc);
  }
  return outData;
};
CipherBase.prototype._transform = function (data, _, next) {
  this.push(this._update(data));
  next();
};
CipherBase.prototype._flush = function (next) {
  try {
    this.push(this._final());
  } catch(e) {
    return next(e);
  }
  next();
};
CipherBase.prototype.final = function (outputEnc) {
  var outData = this._final() || new Buffer('');
  if (outputEnc) {
    outData = outData.toString(outputEnc);
  }
  return outData;
};
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer","inherits":143,"stream":159}],12:[function(require,module,exports){
(function (Buffer){
var aes = require('./aes');
var Transform = require('./cipherBase');
var inherits = require('inherits');
var modes = require('./modes');
var StreamCipher = require('./streamCipher');
var AuthCipher = require('./authCipher');
var ebtk = require('./EVP_BytesToKey');

inherits(Decipher, Transform);
function Decipher(mode, key, iv) {
  if (!(this instanceof Decipher)) {
    return new Decipher(mode, key, iv);
  }
  Transform.call(this);
  this._cache = new Splitter();
  this._last = void 0;
  this._cipher = new aes.AES(key);
  this._prev = new Buffer(iv.length);
  iv.copy(this._prev);
  this._mode = mode;
  this._autopadding = true;
}
Decipher.prototype._update = function (data) {
  this._cache.add(data);
  var chunk;
  var thing;
  var out = [];
  while ((chunk = this._cache.get(this._autopadding))) {
    thing = this._mode.decrypt(this, chunk);
    out.push(thing);
  }
  return Buffer.concat(out);
};
Decipher.prototype._final = function () {
  var chunk = this._cache.flush();
  if (this._autopadding) {
    return unpad(this._mode.decrypt(this, chunk));
  } else if (chunk) {
    throw new Error('data not multiple of block length');
  }
};
Decipher.prototype.setAutoPadding = function (setTo) {
  this._autopadding = !!setTo;
};
function Splitter() {
   if (!(this instanceof Splitter)) {
    return new Splitter();
  }
  this.cache = new Buffer('');
}
Splitter.prototype.add = function (data) {
  this.cache = Buffer.concat([this.cache, data]);
};

Splitter.prototype.get = function (autoPadding) {
  var out;
  if (autoPadding) {
    if (this.cache.length > 16) {
      out = this.cache.slice(0, 16);
      this.cache = this.cache.slice(16);
      return out;
    }
  } else {
    if (this.cache.length >= 16) {
      out = this.cache.slice(0, 16);
      this.cache = this.cache.slice(16);
      return out;
    }
  }
  return null;
};
Splitter.prototype.flush = function () {
  if (this.cache.length) {
    return this.cache;
  }
};
function unpad(last) {
  var padded = last[15];
  var i = -1;
  while (++i < padded) {
    if (last[(i + (16 - padded))] !== padded) {
      throw new Error('unable to decrypt data');
    }
  }
  if (padded === 16) {
    return;
  }
  return last.slice(0, 16 - padded);
}

var modelist = {
  ECB: require('./modes/ecb'),
  CBC: require('./modes/cbc'),
  CFB: require('./modes/cfb'),
  CFB8: require('./modes/cfb8'),
  CFB1: require('./modes/cfb1'),
  OFB: require('./modes/ofb'),
  CTR: require('./modes/ctr'),
  GCM: require('./modes/ctr')
};


function createDecipheriv(suite, password, iv) {
  var config = modes[suite.toLowerCase()];
  if (!config) {
    throw new TypeError('invalid suite type');
  }
  if (typeof iv === 'string') {
    iv = new Buffer(iv);
  }
  if (typeof password === 'string') {
    password = new Buffer(password);
  }
  if (password.length !== config.key/8) {
    throw new TypeError('invalid key length ' + password.length);
  }
  if (iv.length !== config.iv) {
    throw new TypeError('invalid iv length ' + iv.length);
  }
  if (config.type === 'stream') {
    return new StreamCipher(modelist[config.mode], password, iv, true);
  } else if (config.type === 'auth') {
    return new AuthCipher(modelist[config.mode], password, iv, true);
  }
  return new Decipher(modelist[config.mode], password, iv);
}

function createDecipher (suite, password) {
  var config = modes[suite.toLowerCase()];
  if (!config) {
    throw new TypeError('invalid suite type');
  }
  var keys = ebtk(password, config.key, config.iv);
  return createDecipheriv(suite, keys.key, keys.iv);
}
exports.createDecipher = createDecipher;
exports.createDecipheriv = createDecipheriv;
}).call(this,require("buffer").Buffer)
},{"./EVP_BytesToKey":7,"./aes":8,"./authCipher":9,"./cipherBase":11,"./modes":15,"./modes/cbc":16,"./modes/cfb":17,"./modes/cfb1":18,"./modes/cfb8":19,"./modes/ctr":20,"./modes/ecb":21,"./modes/ofb":22,"./streamCipher":23,"buffer":"buffer","inherits":143}],13:[function(require,module,exports){
(function (Buffer){
var aes = require('./aes');
var Transform = require('./cipherBase');
var inherits = require('inherits');
var modes = require('./modes');
var ebtk = require('./EVP_BytesToKey');
var StreamCipher = require('./streamCipher');
var AuthCipher = require('./authCipher');
inherits(Cipher, Transform);
function Cipher(mode, key, iv) {
  if (!(this instanceof Cipher)) {
    return new Cipher(mode, key, iv);
  }
  Transform.call(this);
  this._cache = new Splitter();
  this._cipher = new aes.AES(key);
  this._prev = new Buffer(iv.length);
  iv.copy(this._prev);
  this._mode = mode;
  this._autopadding = true;
}
Cipher.prototype._update = function (data) {
  this._cache.add(data);
  var chunk;
  var thing;
  var out = [];
  while ((chunk = this._cache.get())) {
    thing = this._mode.encrypt(this, chunk);
    out.push(thing);
  }
  return Buffer.concat(out);
};
Cipher.prototype._final = function () {
  var chunk = this._cache.flush();
  if (this._autopadding) {
    chunk = this._mode.encrypt(this, chunk);
    this._cipher.scrub();
    return chunk;
  } else if (chunk.toString('hex') !== '10101010101010101010101010101010') {
    this._cipher.scrub();
    throw new Error('data not multiple of block length');
  }
};
Cipher.prototype.setAutoPadding = function (setTo) {
  this._autopadding = !!setTo;
};

function Splitter() {
   if (!(this instanceof Splitter)) {
    return new Splitter();
  }
  this.cache = new Buffer('');
}
Splitter.prototype.add = function (data) {
  this.cache = Buffer.concat([this.cache, data]);
};

Splitter.prototype.get = function () {
  if (this.cache.length > 15) {
    var out = this.cache.slice(0, 16);
    this.cache = this.cache.slice(16);
    return out;
  }
  return null;
};
Splitter.prototype.flush = function () {
  var len = 16 - this.cache.length;
  var padBuff = new Buffer(len);

  var i = -1;
  while (++i < len) {
    padBuff.writeUInt8(len, i);
  }
  var out = Buffer.concat([this.cache, padBuff]);
  return out;
};
var modelist = {
  ECB: require('./modes/ecb'),
  CBC: require('./modes/cbc'),
  CFB: require('./modes/cfb'),
  CFB8: require('./modes/cfb8'),
  CFB1: require('./modes/cfb1'),
  OFB: require('./modes/ofb'),
  CTR: require('./modes/ctr'),
  GCM: require('./modes/ctr')
};

function createCipheriv(suite, password, iv) {
  var config = modes[suite.toLowerCase()];
  if (!config) {
    throw new TypeError('invalid suite type');
  }
  if (typeof iv === 'string') {
    iv = new Buffer(iv);
  }
  if (typeof password === 'string') {
    password = new Buffer(password);
  }
  if (password.length !== config.key/8) {
    throw new TypeError('invalid key length ' + password.length);
  }
  if (iv.length !== config.iv) {
    throw new TypeError('invalid iv length ' + iv.length);
  }
  if (config.type === 'stream') {
    return new StreamCipher(modelist[config.mode], password, iv);
  } else if (config.type === 'auth') {
    return new AuthCipher(modelist[config.mode], password, iv);
  }
  return new Cipher(modelist[config.mode], password, iv);
}
function createCipher (suite, password) {
  var config = modes[suite.toLowerCase()];
  if (!config) {
    throw new TypeError('invalid suite type');
  }
  var keys = ebtk(password, config.key, config.iv);
  return createCipheriv(suite, keys.key, keys.iv);
}

exports.createCipheriv = createCipheriv;
exports.createCipher = createCipher;
}).call(this,require("buffer").Buffer)
},{"./EVP_BytesToKey":7,"./aes":8,"./authCipher":9,"./cipherBase":11,"./modes":15,"./modes/cbc":16,"./modes/cfb":17,"./modes/cfb1":18,"./modes/cfb8":19,"./modes/ctr":20,"./modes/ecb":21,"./modes/ofb":22,"./streamCipher":23,"buffer":"buffer","inherits":143}],14:[function(require,module,exports){
(function (Buffer){
var zeros = new Buffer(16);
zeros.fill(0);
module.exports = GHASH;
function GHASH(key){
  this.h = key;
  this.state = new Buffer(16);
  this.state.fill(0);
  this.cache = new Buffer('');
}
// from http://bitwiseshiftleft.github.io/sjcl/doc/symbols/src/core_gcm.js.html
// by Juho Vähä-Herttua
GHASH.prototype.ghash = function (block) {
  var i = -1;
  while (++i < block.length) {
   this.state[i] ^= block[i];
  }
  this._multiply();
};

GHASH.prototype._multiply = function () {
  var Vi = toArray(this.h);
  var Zi = [0, 0, 0, 0];
  var j, xi, lsb_Vi;
  var i = -1;
  while (++i < 128) {
    xi = (this.state[~~(i/8)] & (1 << (7-i%8))) !== 0;
    if (xi) {
      // Z_i+1 = Z_i ^ V_i
      Zi = xor(Zi, Vi);
    }

    // Store the value of LSB(V_i)
    lsb_Vi = (Vi[3] & 1) !== 0;

    // V_i+1 = V_i >> 1
    for (j=3; j>0; j--) {
      Vi[j] = (Vi[j] >>> 1) | ((Vi[j-1]&1) << 31);
    }
    Vi[0] = Vi[0] >>> 1;

    // If LSB(V_i) is 1, V_i+1 = (V_i >> 1) ^ R
    if (lsb_Vi) {
      Vi[0] = Vi[0] ^ (0xe1 << 24);
    }
  }
  this.state = fromArray(Zi);
};
GHASH.prototype.update = function (buf) {
  this.cache = Buffer.concat([this.cache, buf]);
  var chunk;
  while (this.cache.length >= 16) {
    chunk = this.cache.slice(0, 16);
    this.cache = this.cache.slice(16);
    this.ghash(chunk);
  }
};
GHASH.prototype.final = function (abl, bl) {
  if (this.cache.length) {
    this.ghash(Buffer.concat([this.cache, zeros], 16));
  }
  this.ghash(fromArray([
     0, abl,
     0, bl
   ]));
  return this.state;
};

function toArray(buf) {
  return [
    buf.readUInt32BE(0),
    buf.readUInt32BE(4),
    buf.readUInt32BE(8),
    buf.readUInt32BE(12)
  ];
}
function fromArray(out) {
  out = out.map(fixup_uint32);
  var buf = new Buffer(16);
  buf.writeUInt32BE(out[0], 0);
  buf.writeUInt32BE(out[1], 4);
  buf.writeUInt32BE(out[2], 8);
  buf.writeUInt32BE(out[3], 12);
  return buf;
}
var uint_max = Math.pow(2, 32);
function fixup_uint32(x) {
    var ret, x_pos;
    ret = x > uint_max || x < 0 ? (x_pos = Math.abs(x) % uint_max, x < 0 ? uint_max - x_pos : x_pos) : x;
    return ret;
}
function xor(a, b) {
  return [
    a[0] ^ b[0],
    a[1] ^ b[1],
    a[2] ^ b[2],
    a[3] ^ b[3],
  ];
}
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],15:[function(require,module,exports){
exports['aes-128-ecb'] = {
  cipher: 'AES',
  key: 128,
  iv: 0,
  mode: 'ECB',
  type: 'block'
};
exports['aes-192-ecb'] = {
  cipher: 'AES',
  key: 192,
  iv: 0,
  mode: 'ECB',
  type: 'block'
};
exports['aes-256-ecb'] = {
  cipher: 'AES',
  key: 256,
  iv: 0,
  mode: 'ECB',
  type: 'block'
};
exports['aes-128-cbc'] = {
  cipher: 'AES',
  key: 128,
  iv: 16,
  mode: 'CBC',
  type: 'block'
};
exports['aes-192-cbc'] = {
  cipher: 'AES',
  key: 192,
  iv: 16,
  mode: 'CBC',
  type: 'block'
};
exports['aes-256-cbc'] = {
  cipher: 'AES',
  key: 256,
  iv: 16,
  mode: 'CBC',
  type: 'block'
};
exports['aes128'] = exports['aes-128-cbc'];
exports['aes192'] = exports['aes-192-cbc'];
exports['aes256'] = exports['aes-256-cbc'];
exports['aes-128-cfb'] = {
  cipher: 'AES',
  key: 128,
  iv: 16,
  mode: 'CFB',
  type: 'stream'
};
exports['aes-192-cfb'] = {
  cipher: 'AES',
  key: 192,
  iv: 16,
  mode: 'CFB',
  type: 'stream'
};
exports['aes-256-cfb'] = {
  cipher: 'AES',
  key: 256,
  iv: 16,
  mode: 'CFB',
  type: 'stream'
};
exports['aes-128-cfb8'] = {
  cipher: 'AES',
  key: 128,
  iv: 16,
  mode: 'CFB8',
  type: 'stream'
};
exports['aes-192-cfb8'] = {
  cipher: 'AES',
  key: 192,
  iv: 16,
  mode: 'CFB8',
  type: 'stream'
};
exports['aes-256-cfb8'] = {
  cipher: 'AES',
  key: 256,
  iv: 16,
  mode: 'CFB8',
  type: 'stream'
};
exports['aes-128-cfb1'] = {
  cipher: 'AES',
  key: 128,
  iv: 16,
  mode: 'CFB1',
  type: 'stream'
};
exports['aes-192-cfb1'] = {
  cipher: 'AES',
  key: 192,
  iv: 16,
  mode: 'CFB1',
  type: 'stream'
};
exports['aes-256-cfb1'] = {
  cipher: 'AES',
  key: 256,
  iv: 16,
  mode: 'CFB1',
  type: 'stream'
};
exports['aes-128-ofb'] = {
  cipher: 'AES',
  key: 128,
  iv: 16,
  mode: 'OFB',
  type: 'stream'
};
exports['aes-192-ofb'] = {
  cipher: 'AES',
  key: 192,
  iv: 16,
  mode: 'OFB',
  type: 'stream'
};
exports['aes-256-ofb'] = {
  cipher: 'AES',
  key: 256,
  iv: 16,
  mode: 'OFB',
  type: 'stream'
};
exports['aes-128-ctr'] = {
  cipher: 'AES',
  key: 128,
  iv: 16,
  mode: 'CTR',
  type: 'stream'
};
exports['aes-192-ctr'] = {
  cipher: 'AES',
  key: 192,
  iv: 16,
  mode: 'CTR',
  type: 'stream'
};
exports['aes-256-ctr'] = {
  cipher: 'AES',
  key: 256,
  iv: 16,
  mode: 'CTR',
  type: 'stream'
};
exports['aes-128-gcm'] = {
  cipher: 'AES',
  key: 128,
  iv: 12,
  mode: 'GCM',
  type: 'auth'
};
exports['aes-192-gcm'] = {
  cipher: 'AES',
  key: 192,
  iv: 12,
  mode: 'GCM',
  type: 'auth'
};
exports['aes-256-gcm'] = {
  cipher: 'AES',
  key: 256,
  iv: 12,
  mode: 'GCM',
  type: 'auth'
};
},{}],16:[function(require,module,exports){
var xor = require('../xor');
exports.encrypt = function (self, block) {
  var data = xor(block, self._prev);
  self._prev = self._cipher.encryptBlock(data);
  return self._prev;
};
exports.decrypt = function (self, block) {
  var pad = self._prev;
  self._prev = block;
  var out = self._cipher.decryptBlock(block);
  return xor(out, pad);
};
},{"../xor":24}],17:[function(require,module,exports){
(function (Buffer){
var xor = require('../xor');
exports.encrypt = function (self, data, decrypt) {
  var out = new Buffer('');
  var len;
  while (data.length) {
    if (self._cache.length === 0) {
      self._cache = self._cipher.encryptBlock(self._prev);
      self._prev = new Buffer('');
    }
    if (self._cache.length <= data.length) {
      len = self._cache.length;
      out = Buffer.concat([out, encryptStart(self, data.slice(0, len), decrypt)]);
      data = data.slice(len);
    } else {
      out = Buffer.concat([out, encryptStart(self, data, decrypt)]);
      break;
    }
  }
  return out;
};
function encryptStart(self, data, decrypt) {
  var len = data.length;
  var out = xor(data, self._cache);
  self._cache = self._cache.slice(len);
  self._prev = Buffer.concat([self._prev, decrypt?data:out]);
  return out;
}
}).call(this,require("buffer").Buffer)
},{"../xor":24,"buffer":"buffer"}],18:[function(require,module,exports){
(function (Buffer){

function encryptByte(self, byte, decrypt) {
  var pad;
  var i = -1;
  var len = 8;
  var out = 0;
  var bit, value;
  while (++i < len) {
    pad = self._cipher.encryptBlock(self._prev);
    bit = (byte & (1 << (7-i))) ? 0x80:0;
    value = pad[0] ^ bit;
    out += ((value&0x80) >> (i%8));
    self._prev = shiftIn(self._prev, decrypt?bit:value);
  }
  return out;
}
exports.encrypt = function (self, chunk, decrypt) {
  var len = chunk.length;
  var out = new Buffer(len);
  var i = -1;
  while (++i < len) {
    out[i] = encryptByte(self, chunk[i], decrypt);
  }
  return out;
};
function shiftIn(buffer, value) {
  var len = buffer.length;
  var i = -1;
  var out = new Buffer(buffer.length);
  buffer = Buffer.concat([buffer, new Buffer([value])]);
  while(++i < len) {
    out[i] = buffer[i]<<1 | buffer[i+1]>>(7);
  }
  return out;
}
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],19:[function(require,module,exports){
(function (Buffer){
function encryptByte(self, byte, decrypt) {
  var pad = self._cipher.encryptBlock(self._prev);
  var out = pad[0] ^ byte;
  self._prev = Buffer.concat([self._prev.slice(1), new Buffer([decrypt?byte:out])]);
  return out;
}
exports.encrypt = function (self, chunk, decrypt) {
  var len = chunk.length;
  var out = new Buffer(len);
  var i = -1;
  while (++i < len) {
    out[i] = encryptByte(self, chunk[i], decrypt);
  }
  return out;
};
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],20:[function(require,module,exports){
(function (Buffer){
var xor = require('../xor');
function getBlock(self) {
  var out = self._cipher.encryptBlock(self._prev);
  incr32(self._prev);
  return out;
}
exports.encrypt = function (self, chunk) {
  while (self._cache.length < chunk.length) {
    self._cache = Buffer.concat([self._cache, getBlock(self)]);
  }
  var pad = self._cache.slice(0, chunk.length);
  self._cache = self._cache.slice(chunk.length);
  return xor(chunk, pad);
};
function incr32(iv) {
  var len = iv.length;
  var item;
  while (len--) {
    item = iv.readUInt8(len);
    if (item === 255) {
      iv.writeUInt8(0, len);
    } else {
      item++;
      iv.writeUInt8(item, len);
      break;
    }
  }
}
}).call(this,require("buffer").Buffer)
},{"../xor":24,"buffer":"buffer"}],21:[function(require,module,exports){
exports.encrypt = function (self, block) {
  return self._cipher.encryptBlock(block);
};
exports.decrypt = function (self, block) {
  return self._cipher.decryptBlock(block);
};
},{}],22:[function(require,module,exports){
(function (Buffer){
var xor = require('../xor');
function getBlock(self) {
  self._prev = self._cipher.encryptBlock(self._prev);
  return self._prev;
}
exports.encrypt = function (self, chunk) {
  while (self._cache.length < chunk.length) {
    self._cache = Buffer.concat([self._cache, getBlock(self)]);
  }
  var pad = self._cache.slice(0, chunk.length);
  self._cache = self._cache.slice(chunk.length);
  return xor(chunk, pad);
};
}).call(this,require("buffer").Buffer)
},{"../xor":24,"buffer":"buffer"}],23:[function(require,module,exports){
(function (Buffer){
var aes = require('./aes');
var Transform = require('./cipherBase');
var inherits = require('inherits');

inherits(StreamCipher, Transform);
module.exports = StreamCipher;
function StreamCipher(mode, key, iv, decrypt) {
  if (!(this instanceof StreamCipher)) {
    return new StreamCipher(mode, key, iv);
  }
  Transform.call(this);
  this._cipher = new aes.AES(key);
  this._prev = new Buffer(iv.length);
  this._cache = new Buffer('');
  this._secCache = new Buffer('');
  this._decrypt = decrypt;
  iv.copy(this._prev);
  this._mode = mode;
}
StreamCipher.prototype._update = function (chunk) {
  return this._mode.encrypt(this, chunk, this._decrypt);
};
StreamCipher.prototype._final = function () {
  this._cipher.scrub();
};
}).call(this,require("buffer").Buffer)
},{"./aes":8,"./cipherBase":11,"buffer":"buffer","inherits":143}],24:[function(require,module,exports){
(function (Buffer){
module.exports = xor;
function xor(a, b) {
  var len = Math.min(a.length, b.length);
  var out = new Buffer(len);
  var i = -1;
  while (++i < len) {
    out.writeUInt8(a[i] ^ b[i], i);
  }
  return out;
}
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],25:[function(require,module,exports){
(function (Buffer){
exports['RSA-SHA224'] = exports.sha224WithRSAEncryption = {
  sign: 'rsa',
  hash: 'sha224',
  id: new Buffer('302d300d06096086480165030402040500041c', 'hex')
};
exports['RSA-SHA256'] = exports.sha256WithRSAEncryption = {
  sign: 'rsa',
  hash: 'sha256',
  id: new Buffer('3031300d060960864801650304020105000420', 'hex')
};
exports['RSA-SHA384'] = exports.sha384WithRSAEncryption = {
  sign: 'rsa',
  hash: 'sha384',
  id: new Buffer('3041300d060960864801650304020205000430', 'hex')
};
exports['RSA-SHA512'] = exports.sha512WithRSAEncryption = {
  sign: 'rsa',
  hash: 'sha512',
  id: new Buffer('3051300d060960864801650304020305000440', 'hex')
};
exports['RSA-SHA1'] = {
	sign: 'rsa',
	hash: 'sha1',
	id: new Buffer('3021300906052b0e03021a05000414', 'hex')
};
exports['ecdsa-with-SHA1'] = {
	sign: 'ecdsa',
	hash: 'sha1',
	id: new Buffer('', 'hex')
};
exports.DSA = exports['DSA-SHA1'] = exports['DSA-SHA'] = {
  sign: 'dsa',
  hash: 'sha1',
  id: new Buffer('', 'hex')
};
exports['DSA-SHA224'] = exports['DSA-WITH-SHA224'] = {
  sign: 'dsa',
  hash: 'sha224',
  id: new Buffer('', 'hex')
};
exports['DSA-SHA256'] = exports['DSA-WITH-SHA256'] = {
  sign: 'dsa',
  hash: 'sha256',
  id: new Buffer('', 'hex')
};
exports['DSA-SHA384'] = exports['DSA-WITH-SHA384'] = {
  sign: 'dsa',
  hash: 'sha384',
  id: new Buffer('', 'hex')
};
exports['DSA-SHA512'] = exports['DSA-WITH-SHA512'] = {
  sign: 'dsa',
  hash: 'sha512',
  id: new Buffer('', 'hex')
};
exports['DSA-RIPEMD160'] = {
  sign: 'dsa',
  hash: 'rmd160',
  id: new Buffer('', 'hex')
};
exports['RSA-RIPEMD160'] = exports.ripemd160WithRSA = {
  sign: 'rsa',
  hash: 'rmd160',
  id: new Buffer('3021300906052b2403020105000414', 'hex')
};
exports['RSA-MD5'] = exports.md5WithRSAEncryption = {
  sign: 'rsa',
  hash: 'md5',
  id: new Buffer('3020300c06082a864886f70d020505000410', 'hex')
};
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],26:[function(require,module,exports){
(function (Buffer){
var sign = require('./sign');
var verify = require('./verify');
var stream = require('stream');
var inherits = require('inherits');
var _algos = require('./algos');
var algos = {};
Object.keys(_algos).forEach(function (key) {
	algos[key] = algos[key.toLowerCase()] = _algos[key];
});
'use strict';
module.exports = function (exports, crypto) {
	exports.createSign = exports.Sign = createSign;
	function createSign(algorithm) {

		return new Sign(algorithm, crypto);
	}
	exports.createVerify = exports.Verify = createVerify;
	function createVerify(algorithm) {
		return new Verify(algorithm, crypto);
	}
};
inherits(Sign, stream.Writable);
function Sign(algorithm, crypto) {
	stream.Writable.call(this);
	var data = algos[algorithm];
	if (!data) {
		throw new Error('Unknown message digest');
	}
	this._hashType = data.hash;
	this._hash = crypto.createHash(data.hash);
	this._tag = data.id;
	this._crypto = crypto;
}
Sign.prototype._write = function _write(data, _, done) {
	this._hash.update(data);
	done();
};
Sign.prototype.update = function update(data) {
	this.write(data);
	return this;
};

Sign.prototype.sign = function signMethod(key, enc) {
	this.end();
	var hash = this._hash.digest();
	var sig = sign(Buffer.concat([this._tag, hash]), key, this._hashType, this._crypto);
	if (enc) {
		sig = sig.toString(enc);
	}
	return sig;
};

inherits(Verify, stream.Writable);
function Verify(algorithm, crypto) {
	stream.Writable.call(this);
	var data = algos[algorithm];
	if (!data) {
		throw new Error('Unknown message digest');
	}
	this._hash = crypto.createHash(data.hash);
	this._tag = data.id;
}
Verify.prototype._write = function _write(data, _, done) {
	this._hash.update(data);
	done();
};
Verify.prototype.update = function update(data) {
	this.write(data);
	return this;
};

Verify.prototype.verify = function verifyMethod(key, sig, enc) {
	this.end();
	var hash = this._hash.digest();
	if (!Buffer.isBuffer(sig)) {
		sig = new Buffer(sig, enc);
	}
	return verify(sig, Buffer.concat([this._tag, hash]), key);
};
}).call(this,require("buffer").Buffer)
},{"./algos":25,"./sign":69,"./verify":70,"buffer":"buffer","inherits":143,"stream":159}],27:[function(require,module,exports){
// Utils

function assert(val, msg) {
  if (!val)
    throw new Error(msg || 'Assertion failed');
}

function assertEqual(l, r, msg) {
  if (l != r)
    throw new Error(msg || ('Assertion failed: ' + l + ' != ' + r));
}

// Could use `inherits` module, but don't want to move from single file
// architecture yet.
function inherits(ctor, superCtor) {
  ctor.super_ = superCtor
  var TempCtor = function () {}
  TempCtor.prototype = superCtor.prototype
  ctor.prototype = new TempCtor()
  ctor.prototype.constructor = ctor
}

// BN

function BN(number, base, endian) {
  // May be `new BN(bn)` ?
  if (number !== null &&
      typeof number === 'object' &&
      Array.isArray(number.words)) {
    return number;
  }

  this.sign = false;
  this.words = null;
  this.length = 0;

  // Reduction context
  this.red = null;

  if (base === 'le' || base === 'be') {
    endian = base;
    base = 10;
  }

  if (number !== null)
    this._init(number || 0, base || 10, endian || 'be');
}
if (typeof module === 'object')
  module.exports = BN;

BN.BN = BN;
BN.wordSize = 26;

BN.prototype._init = function init(number, base, endian) {
  if (typeof number === 'number') {
    if (number < 0) {
      this.sign = true;
      number = -number;
    }
    if (number < 0x4000000) {
      this.words = [ number & 0x3ffffff ];
      this.length = 1;
    } else {
      this.words = [
        number & 0x3ffffff,
        (number / 0x4000000) & 0x3ffffff
      ];
      this.length = 2;
    }
    return;
  } else if (typeof number === 'object') {
    return this._initArray(number, base, endian);
  }
  if (base === 'hex')
    base = 16;
  assert(base === (base | 0) && base >= 2 && base <= 36);

  number = number.toString().replace(/\s+/g, '');
  var start = 0;
  if (number[0] === '-')
    start++;

  if (base === 16)
    this._parseHex(number, start);
  else
    this._parseBase(number, base, start);

  if (number[0] === '-')
    this.sign = true;

  this.strip();
};

BN.prototype._initArray = function _initArray(number, base, endian) {
  // Perhaps a Uint8Array
  assert(typeof number.length === 'number');
  this.length = Math.ceil(number.length / 3);
  this.words = new Array(this.length);
  for (var i = 0; i < this.length; i++)
    this.words[i] = 0;

  var off = 0;
  if (endian === 'be') {
    for (var i = number.length - 1, j = 0; i >= 0; i -= 3) {
      var w = number[i] | (number[i - 1] << 8) | (number[i - 2] << 16);
      this.words[j] |= (w << off) & 0x3ffffff;
      this.words[j + 1] = (w >>> (26 - off)) & 0x3ffffff;
      off += 24;
      if (off >= 26) {
        off -= 26;
        j++;
      }
    }
  } else if (endian === 'le') {
    for (var i = 0, j = 0; i < number.length; i += 3) {
      var w = number[i] | (number[i + 1] << 8) | (number[i + 2] << 16);
      this.words[j] |= (w << off) & 0x3ffffff;
      this.words[j + 1] = (w >>> (26 - off)) & 0x3ffffff;
      off += 24;
      if (off >= 26) {
        off -= 26;
        j++;
      }
    }
  }
  return this.strip();
};

function parseHex(str, start, end) {
  var r = 0;
  var len = Math.min(str.length, end);
  for (var i = start; i < len; i++) {
    var c = str.charCodeAt(i) - 48;

    r <<= 4;

    // 'a' - 'f'
    if (c >= 49 && c <= 54)
      r |= c - 49 + 0xa;

    // 'A' - 'F'
    else if (c >= 17 && c <= 22)
      r |= c - 17 + 0xa;

    // '0' - '9'
    else
      r |= c & 0xf;
  }
  return r;
}

BN.prototype._parseHex = function _parseHex(number, start) {
  // Create possibly bigger array to ensure that it fits the number
  this.length = Math.ceil((number.length - start) / 6);
  this.words = new Array(this.length);
  for (var i = 0; i < this.length; i++)
    this.words[i] = 0;

  // Scan 24-bit chunks and add them to the number
  var off = 0;
  for (var i = number.length - 6, j = 0; i >= start; i -= 6) {
    var w = parseHex(number, i, i + 6);
    this.words[j] |= (w << off) & 0x3ffffff;
    this.words[j + 1] |= w >>> (26 - off) & 0x3fffff;
    off += 24;
    if (off >= 26) {
      off -= 26;
      j++;
    }
  }
  if (i + 6 !== start) {
    var w = parseHex(number, start, i + 6);
    this.words[j] |= (w << off) & 0x3ffffff;
    this.words[j + 1] |= w >>> (26 - off) & 0x3fffff;
  }
  this.strip();
};

function parseBase(str, start, end, mul) {
  var r = 0;
  var len = Math.min(str.length, end);
  for (var i = start; i < len; i++) {
    var c = str.charCodeAt(i) - 48;

    r *= mul;

    // 'a'
    if (c >= 49)
      r += c - 49 + 0xa;

    // 'A'
    else if (c >= 17)
      r += c - 17 + 0xa;

    // '0' - '9'
    else
      r += c;
  }
  return r;
}

BN.prototype._parseBase = function _parseBase(number, base, start) {
  // Initialize as zero
  this.words = [ 0 ];
  this.length = 1;

  // Find length of limb in base
  for (var limbLen = 0, limbPow = 1; limbPow <= 0x3ffffff; limbPow *= base)
    limbLen++;
  limbLen--;
  limbPow = (limbPow / base) | 0;

  var total = number.length - start;
  var mod = total % limbLen;
  var end = Math.min(total, total - mod) + start;

  var word = 0;
  for (var i = start; i < end; i += limbLen) {
    word = parseBase(number, i, i + limbLen, base);

    this.imuln(limbPow);
    this.words[0] += word;
  }

  if (mod !== 0) {
    var pow = 1;
    var word = parseBase(number, i, number.length, base);

    for (var i = 0; i < mod; i++)
      pow *= base;
    this.imuln(pow);
    this.words[0] += word;
  }
};

BN.prototype.copy = function copy(dest) {
  dest.words = new Array(this.length);
  for (var i = 0; i < this.length; i++)
    dest.words[i] = this.words[i];
  dest.length = this.length;
  dest.sign = this.sign;
  dest.red = this.red;
};

BN.prototype.clone = function clone() {
  var r = new BN(null);
  this.copy(r);
  return r;
};

// Remove leading `0` from `this`
BN.prototype.strip = function strip() {
  while (this.length > 1 && this.words[this.length - 1] === 0)
    this.length--;
  return this._normSign();
};

BN.prototype._normSign = function _normSign() {
  // -0 = 0
  if (this.length === 1 && this.words[0] === 0)
    this.sign = false;
  return this;
};

BN.prototype.inspect = function inspect() {
  return (this.red ? '<BN-R: ' : '<BN: ') + this.toString(16) + '>';
};

/*

var zeros = [];
var groupSizes = [];
var groupBases = [];

var s = '';
var i = -1;
while (++i < BN.wordSize) {
  zeros[i] = s;
  s += '0';
}
groupSizes[0] = 0;
groupSizes[1] = 0;
groupBases[0] = 0;
groupBases[1] = 0;
var base = 2 - 1;
while (++base < 36 + 1) {
  var groupSize = 0;
  var groupBase = 1;
  // TODO: <=
  while (groupBase < (1 << BN.wordSize) / base) {
    groupBase *= base;
    groupSize += 1;
  }
  groupSizes[base] = groupSize;
  groupBases[base] = groupBase;
}

*/

var zeros = [
  '',
  '0',
  '00',
  '000',
  '0000',
  '00000',
  '000000',
  '0000000',
  '00000000',
  '000000000',
  '0000000000',
  '00000000000',
  '000000000000',
  '0000000000000',
  '00000000000000',
  '000000000000000',
  '0000000000000000',
  '00000000000000000',
  '000000000000000000',
  '0000000000000000000',
  '00000000000000000000',
  '000000000000000000000',
  '0000000000000000000000',
  '00000000000000000000000',
  '000000000000000000000000',
  '0000000000000000000000000'
];

var groupSizes = [
  0, 0,
  25, 16, 12, 11, 10, 9, 8,
  8, 7, 7, 7, 7, 6, 6,
  6, 6, 6, 6, 6, 5, 5,
  5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5
];

var groupBases = [
  0, 0,
  33554432, 43046721, 16777216, 48828125, 60466176, 40353607, 16777216,
  43046721, 10000000, 19487171, 35831808, 62748517, 7529536, 11390625,
  16777216, 24137569, 34012224, 47045881, 64000000, 4084101, 5153632,
  6436343, 7962624, 9765625, 11881376, 14348907, 17210368, 20511149,
  24300000, 28629151, 33554432, 39135393, 45435424, 52521875, 60466176
];

BN.prototype.toString = function toString(base, padding) {
  base = base || 10;
  if (base === 16 || base === 'hex') {
    var out = '';
    var off = 0;
    var padding = padding | 0 || 1;
    var carry = 0;
    for (var i = 0; i < this.length; i++) {
      var w = this.words[i];
      var word = (((w << off) | carry) & 0xffffff).toString(16);
      carry = (w >>> (24 - off)) & 0xffffff;
      if (carry !== 0 || i !== this.length - 1)
        out = zeros[6 - word.length] + word + out;
      else
        out = word + out;
      off += 2;
      if (off >= 26) {
        off -= 26;
        i--;
      }
    }
    if (carry !== 0)
      out = carry.toString(16) + out;
    while (out.length % padding !== 0)
      out = '0' + out;
    if (this.sign)
      out = '-' + out;
    return out;
  } else if (base === (base | 0) && base >= 2 && base <= 36) {
    // var groupSize = Math.floor(BN.wordSize * Math.LN2 / Math.log(base));
    var groupSize = groupSizes[base];
    // var groupBase = Math.pow(base, groupSize);
    var groupBase = groupBases[base];
    var out = '';
    var c = this.clone();
    c.sign = false;
    while (c.cmpn(0) !== 0) {
      var r = c.modn(groupBase).toString(base);
      c = c.idivn(groupBase);

      if (c.cmpn(0) !== 0)
        out = zeros[groupSize - r.length] + r + out;
      else
        out = r + out;
    }
    if (this.cmpn(0) === 0)
      out = '0' + out;
    if (this.sign)
      out = '-' + out;
    return out;
  } else {
    assert(false, 'Base should be between 2 and 36');
  }
};

BN.prototype.toJSON = function toJSON() {
  return this.toString(16);
};

BN.prototype.toArray = function toArray() {
  this.strip();
  var res = new Array(this.byteLength());
  res[0] = 0;

  var q = this.clone();
  for (var i = 0; q.cmpn(0) !== 0; i++) {
    var b = q.andln(0xff);
    q.ishrn(8);

    // Assume big-endian
    res[res.length - i - 1] = b;
  }

  return res;
};

/*
function genCountBits(bits) {
  var arr = [];

  for (var i = bits - 1; i >= 0; i--) {
    var bit = '0x' + (1 << i).toString(16);
    arr.push('w >= ' + bit + ' ? ' + (i + 1));
  }

  return new Function('w', 'return ' + arr.join(' :\n') + ' :\n0;');
};

BN.prototype._countBits = genCountBits(26);
*/

// Sadly chrome apps could not contain `new Function()` calls
BN.prototype._countBits = function _countBits(w) {
  return w >= 0x2000000 ? 26 :
         w >= 0x1000000 ? 25 :
         w >= 0x800000 ? 24 :
         w >= 0x400000 ? 23 :
         w >= 0x200000 ? 22 :
         w >= 0x100000 ? 21 :
         w >= 0x80000 ? 20 :
         w >= 0x40000 ? 19 :
         w >= 0x20000 ? 18 :
         w >= 0x10000 ? 17 :
         w >= 0x8000 ? 16 :
         w >= 0x4000 ? 15 :
         w >= 0x2000 ? 14 :
         w >= 0x1000 ? 13 :
         w >= 0x800 ? 12 :
         w >= 0x400 ? 11 :
         w >= 0x200 ? 10 :
         w >= 0x100 ? 9 :
         w >= 0x80 ? 8 :
         w >= 0x40 ? 7 :
         w >= 0x20 ? 6 :
         w >= 0x10 ? 5 :
         w >= 0x8 ? 4 :
         w >= 0x4 ? 3 :
         w >= 0x2 ? 2 :
         w >= 0x1 ? 1 :
         0;
};

// Return number of used bits in a BN
BN.prototype.bitLength = function bitLength() {
  var hi = 0;
  var w = this.words[this.length - 1];
  var hi = this._countBits(w);
  return (this.length - 1) * 26 + hi;
};

BN.prototype.byteLength = function byteLength() {
  var hi = 0;
  var w = this.words[this.length - 1];
  return Math.ceil(this.bitLength() / 8);
};

// Return negative clone of `this`
BN.prototype.neg = function neg() {
  if (this.cmpn(0) === 0)
    return this.clone();

  var r = this.clone();
  r.sign = !this.sign;
  return r;
};

// Add `num` to `this` in-place
BN.prototype.iadd = function iadd(num) {
  // negative + positive
  if (this.sign && !num.sign) {
    this.sign = false;
    var r = this.isub(num);
    this.sign = !this.sign;
    return this._normSign();

  // positive + negative
  } else if (!this.sign && num.sign) {
    num.sign = false;
    var r = this.isub(num);
    num.sign = true;
    return r._normSign();
  }

  // a.length > b.length
  var a;
  var b;
  if (this.length > num.length) {
    a = this;
    b = num;
  } else {
    a = num;
    b = this;
  }

  var carry = 0;
  for (var i = 0; i < b.length; i++) {
    var r = a.words[i] + b.words[i] + carry;
    this.words[i] = r & 0x3ffffff;
    carry = r >>> 26;
  }
  for (; carry !== 0 && i < a.length; i++) {
    var r = a.words[i] + carry;
    this.words[i] = r & 0x3ffffff;
    carry = r >>> 26;
  }

  this.length = a.length;
  if (carry !== 0) {
    this.words[this.length] = carry;
    this.length++;
  // Copy the rest of the words
  } else if (a !== this) {
    for (; i < a.length; i++)
      this.words[i] = a.words[i];
  }

  return this;
};

// Add `num` to `this`
BN.prototype.add = function add(num) {
  if (num.sign && !this.sign) {
    num.sign = false;
    var res = this.sub(num);
    num.sign = true;
    return res;
  } else if (!num.sign && this.sign) {
    this.sign = false;
    var res = num.sub(this);
    this.sign = true;
    return res;
  }

  if (this.length > num.length)
    return this.clone().iadd(num);
  else
    return num.clone().iadd(this);
};

// Subtract `num` from `this` in-place
BN.prototype.isub = function isub(num) {
  // this - (-num) = this + num
  if (num.sign) {
    num.sign = false;
    var r = this.iadd(num);
    num.sign = true;
    return r._normSign();

  // -this - num = -(this + num)
  } else if (this.sign) {
    this.sign = false;
    this.iadd(num);
    this.sign = true;
    return this._normSign();
  }

  // At this point both numbers are positive
  var cmp = this.cmp(num);

  // Optimization - zeroify
  if (cmp === 0) {
    this.sign = false;
    this.length = 1;
    this.words[0] = 0;
    return this;
  }

  // a > b
  if (cmp > 0) {
    var a = this;
    var b = num;
  } else {
    var a = num;
    var b = this;
  }

  var carry = 0;
  for (var i = 0; i < b.length; i++) {
    var r = a.words[i] - b.words[i] - carry;
    if (r < 0) {
      r += 0x4000000;
      carry = 1;
    } else {
      carry = 0;
    }
    this.words[i] = r;
  }
  for (; carry !== 0 && i < a.length; i++) {
    var r = a.words[i] - carry;
    if (r < 0) {
      r += 0x4000000;
      carry = 1;
    } else {
      carry = 0;
    }
    this.words[i] = r;
  }

  // Copy rest of the words
  if (carry === 0 && i < a.length && a !== this)
    for (; i < a.length; i++)
      this.words[i] = a.words[i];
  this.length = Math.max(this.length, i);

  if (a !== this)
    this.sign = true;

  return this.strip();
};

// Subtract `num` from `this`
BN.prototype.sub = function sub(num) {
  return this.clone().isub(num);
};

/*
// NOTE: This could be potentionally used to generate loop-less multiplications
function _genCombMulTo(alen, blen) {
  var len = alen + blen - 1;
  var src = [
    'var a = this.words, b = num.words, o = out.words, c = 0, w, ' +
        'mask = 0x3ffffff, shift = 0x4000000;',
    'out.length = ' + len + ';'
  ];
  for (var k = 0; k < len; k++) {
    var minJ = Math.max(0, k - alen + 1);
    var maxJ = Math.min(k, blen - 1);

    for (var j = minJ; j <= maxJ; j++) {
      var i = k - j;
      var mul = 'a[' + i + '] * b[' + j + ']';

      if (j === minJ) {
        src.push('w = ' + mul + ' + c;');
        src.push('c = (w / shift) | 0;');
      } else {
        src.push('w += ' + mul + ';');
        src.push('c += (w / shift) | 0;');
      }
      src.push('w &= mask;');
    }
    src.push('o[' + k + '] = w;');
  }
  src.push('if (c !== 0) {',
           '  o[' + k + '] = c;',
           '  out.length++;',
           '}',
           'return out;');

  return src.join('\n');
}
*/

BN.prototype._smallMulTo = function _smallMulTo(num, out) {
  out.sign = num.sign !== this.sign;
  out.length = this.length + num.length;

  var carry = 0;
  for (var k = 0; k < out.length - 1; k++) {
    // Sum all words with the same `i + j = k` and accumulate `ncarry`,
    // note that ncarry could be >= 0x3ffffff
    var ncarry = carry >>> 26;
    var rword = carry & 0x3ffffff;
    var maxJ = Math.min(k, num.length - 1);
    for (var j = Math.max(0, k - this.length + 1); j <= maxJ; j++) {
      var i = k - j;
      var a = this.words[i] | 0;
      var b = num.words[j] | 0;
      var r = a * b;

      var lo = r & 0x3ffffff;
      ncarry = (ncarry + ((r / 0x4000000) | 0)) | 0;
      lo = (lo + rword) | 0;
      rword = lo & 0x3ffffff;
      ncarry = (ncarry + (lo >>> 26)) | 0;
    }
    out.words[k] = rword;
    carry = ncarry;
  }
  if (carry !== 0) {
    out.words[k] = carry;
  } else {
    out.length--;
  }

  return out.strip();
};

BN.prototype._bigMulTo = function _bigMulTo(num, out) {
  out.sign = num.sign !== this.sign;
  out.length = this.length + num.length;

  var carry = 0;
  var hncarry = 0;
  for (var k = 0; k < out.length - 1; k++) {
    // Sum all words with the same `i + j = k` and accumulate `ncarry`,
    // note that ncarry could be >= 0x3ffffff
    var ncarry = hncarry;
    hncarry = 0;
    var rword = carry & 0x3ffffff;
    var maxJ = Math.min(k, num.length - 1);
    for (var j = Math.max(0, k - this.length + 1); j <= maxJ; j++) {
      var i = k - j;
      var a = this.words[i] | 0;
      var b = num.words[j] | 0;
      var r = a * b;

      var lo = r & 0x3ffffff;
      ncarry = (ncarry + ((r / 0x4000000) | 0)) | 0;
      lo = (lo + rword) | 0;
      rword = lo & 0x3ffffff;
      ncarry = (ncarry + (lo >>> 26)) | 0;

      hncarry += ncarry >>> 26;
      ncarry &= 0x3ffffff;
    }
    out.words[k] = rword;
    carry = ncarry;
    ncarry = hncarry;
  }
  if (carry !== 0) {
    out.words[k] = carry;
  } else {
    out.length--;
  }

  return out.strip();
};

BN.prototype.mulTo = function mulTo(num, out) {
  var res;
  if (this.length + num.length < 63)
    res = this._smallMulTo(num, out);
  else
    res = this._bigMulTo(num, out);
  return res;
};

// Multiply `this` by `num`
BN.prototype.mul = function mul(num) {
  var out = new BN(null);
  out.words = new Array(this.length + num.length);
  return this.mulTo(num, out);
};

// In-place Multiplication
BN.prototype.imul = function imul(num) {
  if (this.cmpn(0) === 0 || num.cmpn(0) === 0) {
    this.words[0] = 0;
    this.length = 1;
    return this;
  }

  var tlen = this.length;
  var nlen = num.length;

  this.sign = num.sign !== this.sign;
  this.length = this.length + num.length;
  this.words[this.length - 1] = 0;

  var lastCarry = 0;
  for (var k = this.length - 2; k >= 0; k--) {
    // Sum all words with the same `i + j = k` and accumulate `carry`,
    // note that carry could be >= 0x3ffffff
    var carry = 0;
    var rword = 0;
    var maxJ = Math.min(k, nlen - 1);
    for (var j = Math.max(0, k - tlen + 1); j <= maxJ; j++) {
      var i = k - j;
      var a = this.words[i];
      var b = num.words[j];
      var r = a * b;

      var lo = r & 0x3ffffff;
      carry += (r / 0x4000000) | 0;
      lo += rword;
      rword = lo & 0x3ffffff;
      carry += lo >>> 26;
    }
    this.words[k] = rword;
    this.words[k + 1] += carry;
    carry = 0;
  }

  // Propagate overflows
  var carry = 0;
  for (var i = 1; i < this.length; i++) {
    var w = this.words[i] + carry;
    this.words[i] = w & 0x3ffffff;
    carry = w >>> 26;
  }

  return this.strip();
};

BN.prototype.imuln = function imuln(num) {
  assert(typeof num === 'number');

  // Carry
  var carry = 0;
  for (var i = 0; i < this.length; i++) {
    var w = this.words[i] * num;
    var lo = (w & 0x3ffffff) + carry;
    carry = (w / 0x4000000) | 0;
    this.words[i] = lo;
  }

  if (carry !== 0) {
    this.words[i] = carry;
    this.length++;
  }

  return this;
};

// `this` * `this`
BN.prototype.sqr = function sqr() {
  return this.mul(this);
};

// `this` * `this` in-place
BN.prototype.isqr = function isqr() {
  return this.mul(this);
};

// Shift-left in-place
BN.prototype.ishln = function ishln(bits) {
  assert(typeof bits === 'number' && bits >= 0);
  var r = bits % 26;
  var s = (bits - r) / 26;
  var carryMask = (0x3ffffff >>> (26 - r)) << (26 - r);

  var o = this.clone();
  if (r !== 0) {
    var carry = 0;
    for (var i = 0; i < this.length; i++) {
      var newCarry = this.words[i] & carryMask;
      var c = (this.words[i] - newCarry) << r;
      this.words[i] = c | carry;
      carry = newCarry >>> (26 - r);
    }
    if (carry) {
      this.words[i] = carry;
      this.length++;
    }
  }

  if (s !== 0) {
    for (var i = this.length - 1; i >= 0; i--)
      this.words[i + s] = this.words[i];
    for (var i = 0; i < s; i++)
      this.words[i] = 0;
    this.length += s;
  }

  return this.strip();
};

// Shift-right in-place
// NOTE: `hint` is a lowest bit before trailing zeroes
// NOTE: if `extended` is true - { lo: ..., hi: } object will be returned
BN.prototype.ishrn = function ishrn(bits, hint, extended) {
  assert(typeof bits === 'number' && bits >= 0);
  if (hint)
    hint = (hint - (hint % 26)) / 26;
  else
    hint = 0;

  var r = bits % 26;
  var s = Math.min((bits - r) / 26, this.length);
  var mask = 0x3ffffff ^ ((0x3ffffff >>> r) << r);
  var maskedWords = extended;

  hint -= s;
  hint = Math.max(0, hint);

  // Extended mode, copy masked part
  if (maskedWords) {
    for (var i = 0; i < s; i++)
      maskedWords.words[i] = this.words[i];
    maskedWords.length = s;
  }

  if (s === 0) {
    // No-op, we should not move anything at all
  } else if (this.length > s) {
    this.length -= s;
    for (var i = 0; i < this.length; i++)
      this.words[i] = this.words[i + s];
  } else {
    this.words[0] = 0;
    this.length = 1;
  }

  var carry = 0;
  for (var i = this.length - 1; i >= 0 && (carry !== 0 || i >= hint); i--) {
    var word = this.words[i];
    this.words[i] = (carry << (26 - r)) | (word >>> r);
    carry = word & mask;
  }

  // Push carried bits as a mask
  if (maskedWords && carry !== 0)
    maskedWords.words[maskedWords.length++] = carry;

  if (this.length === 0) {
    this.words[0] = 0;
    this.length = 1;
  }

  this.strip();
  if (extended)
    return { hi: this, lo: maskedWords };

  return this;
};

// Shift-left
BN.prototype.shln = function shln(bits) {
  return this.clone().ishln(bits);
};

// Shift-right
BN.prototype.shrn = function shrn(bits) {
  return this.clone().ishrn(bits);
};

// Test if n bit is set
BN.prototype.testn = function testn(bit) {
  assert(typeof bit === 'number' && bit >= 0);
  var r = bit % 26;
  var s = (bit - r) / 26;
  var q = 1 << r;

  // Fast case: bit is much higher than all existing words
  if (this.length <= s) {
    return false;
  }

  // Check bit and return
  var w = this.words[s];

  return !!(w & q);
};

// Return only lowers bits of number (in-place)
BN.prototype.imaskn = function imaskn(bits) {
  assert(typeof bits === 'number' && bits >= 0);
  var r = bits % 26;
  var s = (bits - r) / 26;

  assert(!this.sign, 'imaskn works only with positive numbers');

  if (r !== 0)
    s++;
  this.length = Math.min(s, this.length);

  if (r !== 0) {
    var mask = 0x3ffffff ^ ((0x3ffffff >>> r) << r);
    this.words[this.length - 1] &= mask;
  }

  return this.strip();
};

// Return only lowers bits of number
BN.prototype.maskn = function maskn(bits) {
  return this.clone().imaskn(bits);
};

// Add plain number `num` to `this`
BN.prototype.iaddn = function iaddn(num) {
  assert(typeof num === 'number');
  if (num < 0)
    return this.isubn(-num);

  // Possible sign change
  if (this.sign) {
    if (this.length === 1 && this.words[0] < num) {
      this.words[0] = num - this.words[0];
      this.sign = false;
      return this;
    }

    this.sign = false;
    this.isubn(num);
    this.sign = true;
    return this;
  }
  this.words[0] += num;

  // Carry
  for (var i = 0; i < this.length && this.words[i] >= 0x4000000; i++) {
    this.words[i] -= 0x4000000;
    if (i === this.length - 1)
      this.words[i + 1] = 1;
    else
      this.words[i + 1]++;
  }
  this.length = Math.max(this.length, i + 1);

  return this;
};

// Subtract plain number `num` from `this`
BN.prototype.isubn = function isubn(num) {
  assert(typeof num === 'number');
  if (num < 0)
    return this.iaddn(-num);

  if (this.sign) {
    this.sign = false;
    this.iaddn(num);
    this.sign = true;
    return this;
  }

  this.words[0] -= num;

  // Carry
  for (var i = 0; i < this.length && this.words[i] < 0; i++) {
    this.words[i] += 0x4000000;
    this.words[i + 1] -= 1;
  }

  return this.strip();
};

BN.prototype.addn = function addn(num) {
  return this.clone().iaddn(num);
};

BN.prototype.subn = function subn(num) {
  return this.clone().isubn(num);
};

BN.prototype.iabs = function iabs() {
  this.sign = false;

  return this
};

BN.prototype.abs = function abs() {
  return this.clone().iabs();
};

BN.prototype._wordDiv = function _wordDiv(num, mode) {
  var shift = this.length - num.length;

  var a = this.clone();
  var b = num;

  var q = mode !== 'mod' && new BN(0);
  var sign = false;

  // Approximate quotient at each step
  while (a.length > b.length) {
    // NOTE: a.length is always >= 2, because of the condition .div()
    var hi = a.words[a.length - 1] * 0x4000000 + a.words[a.length - 2];
    var sq = (hi / b.words[b.length - 1]);
    var sqhi = (sq / 0x4000000) | 0;
    var sqlo = sq & 0x3ffffff;
    sq = new BN(null);
    sq.words = [ sqlo, sqhi ];
    sq.length = 2;

    // Collect quotient
    var shift = (a.length - b.length - 1) * 26;
    if (q) {
      var t = sq.shln(shift);
      if (a.sign)
        q.isub(t);
      else
        q.iadd(t);
    }

    sq = sq.mul(b).ishln(shift);
    if (a.sign)
      a.iadd(sq)
    else
      a.isub(sq);
  }
  // At this point a.length <= b.length
  while (a.ucmp(b) >= 0) {
    // NOTE: a.length is always >= 2, because of the condition above
    var hi = a.words[a.length - 1];
    var sq = new BN((hi / b.words[b.length - 1]) | 0);
    var shift = (a.length - b.length) * 26;

    if (q) {
      var t = sq.shln(shift);
      if (a.sign)
        q.isub(t);
      else
        q.iadd(t);
    }

    sq = sq.mul(b).ishln(shift);

    if (a.sign)
      a.iadd(sq);
    else
      a.isub(sq);
  }

  if (a.sign) {
    if (q)
      q.isubn(1);
    a.iadd(b);
  }
  return { div: q ? q : null, mod: a };
};

BN.prototype.divmod = function divmod(num, mode) {
  assert(num.cmpn(0) !== 0);

  if (this.sign && !num.sign) {
    var res = this.neg().divmod(num, mode);
    var div;
    var mod;
    if (mode !== 'mod')
      div = res.div.neg();
    if (mode !== 'div')
      mod = res.mod.cmpn(0) === 0 ? res.mod : num.sub(res.mod);
    return {
      div: div,
      mod: mod
    };
  } else if (!this.sign && num.sign) {
    var res = this.divmod(num.neg(), mode);
    var div;
    if (mode !== 'mod')
      div = res.div.neg();
    return { div: div, mod: res.mod };
  } else if (this.sign && num.sign) {
    return this.neg().divmod(num.neg(), mode);
  }

  // Both numbers are positive at this point

  // Strip both numbers to approximate shift value
  if (num.length > this.length || this.cmp(num) < 0)
    return { div: new BN(0), mod: this };

  // Very short reduction
  if (num.length === 1) {
    if (mode === 'div')
      return { div: this.divn(num.words[0]), mod: null };
    else if (mode === 'mod')
      return { div: null, mod: new BN(this.modn(num.words[0])) };
    return {
      div: this.divn(num.words[0]),
      mod: new BN(this.modn(num.words[0]))
    };
  }

  return this._wordDiv(num, mode);
};

// Find `this` / `num`
BN.prototype.div = function div(num) {
  return this.divmod(num, 'div').div;
};

// Find `this` % `num`
BN.prototype.mod = function mod(num) {
  return this.divmod(num, 'mod').mod;
};

// Find Round(`this` / `num`)
BN.prototype.divRound = function divRound(num) {
  var dm = this.divmod(num);

  // Fast case - exact division
  if (dm.mod.cmpn(0) === 0)
    return dm.div;

  var mod = dm.div.sign ? dm.mod.isub(num) : dm.mod;

  var half = num.shrn(1);
  var r2 = num.andln(1);
  var cmp = mod.cmp(half);

  // Round down
  if (cmp < 0 || r2 === 1 && cmp === 0)
    return dm.div;

  // Round up
  return dm.div.sign ? dm.div.isubn(1) : dm.div.iaddn(1);
};

BN.prototype.modn = function modn(num) {
  assert(num <= 0x3ffffff);
  var p = (1 << 26) % num;

  var acc = 0;
  for (var i = this.length - 1; i >= 0; i--)
    acc = (p * acc + this.words[i]) % num;

  return acc;
};

// In-place division by number
BN.prototype.idivn = function idivn(num) {
  assert(num <= 0x3ffffff);

  var carry = 0;
  for (var i = this.length - 1; i >= 0; i--) {
    var w = this.words[i] + carry * 0x4000000;
    this.words[i] = (w / num) | 0;
    carry = w % num;
  }

  return this.strip();
};

BN.prototype.divn = function divn(num) {
  return this.clone().idivn(num);
};

BN.prototype._egcd = function _egcd(x1, p) {
  assert(!p.sign);
  assert(p.cmpn(0) !== 0);

  var a = this;
  var b = p.clone();

  if (a.sign)
    a = a.mod(p);
  else
    a = a.clone();

  var x2 = new BN(0);
  while (b.isEven())
    b.ishrn(1);
  var delta = b.clone();
  while (a.cmpn(1) > 0 && b.cmpn(1) > 0) {
    while (a.isEven()) {
      a.ishrn(1);
      if (x1.isEven())
        x1.ishrn(1);
      else
        x1.iadd(delta).ishrn(1);
    }
    while (b.isEven()) {
      b.ishrn(1);
      if (x2.isEven())
        x2.ishrn(1);
      else
        x2.iadd(delta).ishrn(1);
    }
    if (a.cmp(b) >= 0) {
      a.isub(b);
      x1.isub(x2);
    } else {
      b.isub(a);
      x2.isub(x1);
    }
  }
  if (a.cmpn(1) === 0)
    return x1;
  else
    return x2;
};

BN.prototype.gcd = function gcd(num) {
  if (this.cmpn(0) === 0)
    return num.clone();
  if (num.cmpn(0) === 0)
    return this.clone();

  var a = this.clone();
  var b = num.clone();
  a.sign = false;
  b.sign = false;

  // Remove common factor of two
  for (var shift = 0; a.isEven() && b.isEven(); shift++) {
    a.ishrn(1);
    b.ishrn(1);
  }

  while (a.isEven())
    a.ishrn(1);

  do {
    while (b.isEven())
      b.ishrn(1);

    // Swap `a` and `b` to make `a` always bigger than `b`
    if (a.cmp(b) < 0) {
      var t = a;
      a = b;
      b = t;
    }
    a.isub(a.div(b).mul(b));
  } while (a.cmpn(0) !== 0 && b.cmpn(0) !== 0);
  if (a.cmpn(0) === 0)
    return b.ishln(shift);
  else
    return a.ishln(shift);
};

// Invert number in the field F(num)
BN.prototype.invm = function invm(num) {
  return this._egcd(new BN(1), num).mod(num);
};

BN.prototype.isEven = function isEven(num) {
  return (this.words[0] & 1) === 0;
};

BN.prototype.isOdd = function isOdd(num) {
  return (this.words[0] & 1) === 1;
};

// And first word and num
BN.prototype.andln = function andln(num) {
  return this.words[0] & num;
};

// Increment at the bit position in-line
BN.prototype.bincn = function bincn(bit) {
  assert(typeof bit === 'number');
  var r = bit % 26;
  var s = (bit - r) / 26;
  var q = 1 << r;

  // Fast case: bit is much higher than all existing words
  if (this.length <= s) {
    for (var i = this.length; i < s + 1; i++)
      this.words[i] = 0;
    this.words[s] |= q;
    this.length = s + 1;
    return this;
  }

  // Add bit and propagate, if needed
  var carry = q;
  for (var i = s; carry !== 0 && i < this.length; i++) {
    var w = this.words[i];
    w += carry;
    carry = w >>> 26;
    w &= 0x3ffffff;
    this.words[i] = w;
  }
  if (carry !== 0) {
    this.words[i] = carry;
    this.length++;
  }
  return this;
};

BN.prototype.cmpn = function cmpn(num) {
  var sign = num < 0;
  if (sign)
    num = -num;

  if (this.sign && !sign)
    return -1;
  else if (!this.sign && sign)
    return 1;

  num &= 0x3ffffff;
  this.strip();

  var res;
  if (this.length > 1) {
    res = 1;
  } else {
    var w = this.words[0];
    res = w === num ? 0 : w < num ? -1 : 1;
  }
  if (this.sign)
    res = -res;
  return res;
};

// Compare two numbers and return:
// 1 - if `this` > `num`
// 0 - if `this` == `num`
// -1 - if `this` < `num`
BN.prototype.cmp = function cmp(num) {
  if (this.sign && !num.sign)
    return -1;
  else if (!this.sign && num.sign)
    return 1;

  var res = this.ucmp(num);
  if (this.sign)
    return -res;
  else
    return res;
};

// Unsigned comparison
BN.prototype.ucmp = function ucmp(num) {
  // At this point both numbers have the same sign
  if (this.length > num.length)
    return 1;
  else if (this.length < num.length)
    return -1;

  var res = 0;
  for (var i = this.length - 1; i >= 0; i--) {
    var a = this.words[i];
    var b = num.words[i];

    if (a === b)
      continue;
    if (a < b)
      res = -1;
    else if (a > b)
      res = 1;
    break;
  }
  return res;
};

//
// A reduce context, could be using montgomery or something better, depending
// on the `m` itself.
//
BN.red = function red(num) {
  return new Red(num);
};

BN.prototype.toRed = function toRed(ctx) {
  assert(!this.red, 'Already a number in reduction context');
  assert(!this.sign, 'red works only with positives');
  return ctx.convertTo(this)._forceRed(ctx);
};

BN.prototype.fromRed = function fromRed() {
  assert(this.red, 'fromRed works only with numbers in reduction context');
  return this.red.convertFrom(this);
};

BN.prototype._forceRed = function _forceRed(ctx) {
  this.red = ctx;
  return this;
};

BN.prototype.forceRed = function forceRed(ctx) {
  assert(!this.red, 'Already a number in reduction context');
  return this._forceRed(ctx);
};

BN.prototype.redAdd = function redAdd(num) {
  assert(this.red, 'redAdd works only with red numbers');
  return this.red.add(this, num);
};

BN.prototype.redIAdd = function redIAdd(num) {
  assert(this.red, 'redIAdd works only with red numbers');
  return this.red.iadd(this, num);
};

BN.prototype.redSub = function redSub(num) {
  assert(this.red, 'redSub works only with red numbers');
  return this.red.sub(this, num);
};

BN.prototype.redISub = function redISub(num) {
  assert(this.red, 'redISub works only with red numbers');
  return this.red.isub(this, num);
};

BN.prototype.redShl = function redShl(num) {
  assert(this.red, 'redShl works only with red numbers');
  return this.red.shl(this, num);
};

BN.prototype.redMul = function redMul(num) {
  assert(this.red, 'redMul works only with red numbers');
  this.red._verify2(this, num);
  return this.red.mul(this, num);
};

BN.prototype.redIMul = function redIMul(num) {
  assert(this.red, 'redMul works only with red numbers');
  this.red._verify2(this, num);
  return this.red.imul(this, num);
};

BN.prototype.redSqr = function redSqr() {
  assert(this.red, 'redSqr works only with red numbers');
  this.red._verify1(this);
  return this.red.sqr(this);
};

BN.prototype.redISqr = function redISqr() {
  assert(this.red, 'redISqr works only with red numbers');
  this.red._verify1(this);
  return this.red.isqr(this);
};

// Square root over p
BN.prototype.redSqrt = function redSqrt() {
  assert(this.red, 'redSqrt works only with red numbers');
  this.red._verify1(this);
  return this.red.sqrt(this);
};

BN.prototype.redInvm = function redInvm() {
  assert(this.red, 'redInvm works only with red numbers');
  this.red._verify1(this);
  return this.red.invm(this);
};

// Return negative clone of `this` % `red modulo`
BN.prototype.redNeg = function redNeg() {
  assert(this.red, 'redNeg works only with red numbers');
  this.red._verify1(this);
  return this.red.neg(this);
};

BN.prototype.redPow = function redPow(num) {
  assert(this.red && !num.red, 'redPow(normalNum)');
  this.red._verify1(this);
  return this.red.pow(this, num);
};

// Prime numbers with efficient reduction
var primes = {
  k256: null,
  p224: null,
  p192: null,
  p25519: null
};

// Pseudo-Mersenne prime
function MPrime(name, p) {
  // P = 2 ^ N - K
  this.name = name;
  this.p = new BN(p, 16);
  this.n = this.p.bitLength();
  this.k = new BN(1).ishln(this.n).isub(this.p);

  this.tmp = this._tmp();
}

MPrime.prototype._tmp = function _tmp() {
  var tmp = new BN(null);
  tmp.words = new Array(Math.ceil(this.n / 13));
  return tmp;
};

MPrime.prototype.ireduce = function ireduce(num) {
  // Assumes that `num` is less than `P^2`
  // num = HI * (2 ^ N - K) + HI * K + LO = HI * K + LO (mod P)
  var r = num;
  var rlen;

  do {
    var pair = r.ishrn(this.n, 0, this.tmp);
    r = this.imulK(pair.hi);
    r = r.iadd(pair.lo);
    rlen = r.bitLength();
  } while (rlen > this.n);

  var cmp = rlen < this.n ? -1 : r.cmp(this.p);
  if (cmp === 0) {
    r.words[0] = 0;
    r.length = 1;
  } else if (cmp > 0) {
    r.isub(this.p);
  } else {
    r.strip();
  }

  return r;
};

MPrime.prototype.imulK = function imulK(num) {
  return num.imul(this.k);
};

function K256() {
  MPrime.call(
    this,
    'k256',
    'ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe fffffc2f');
}
inherits(K256, MPrime);

K256.prototype.imulK = function imulK(num) {
  // K = 0x1000003d1 = [ 0x40, 0x3d1 ]
  num.words[num.length] = 0;
  num.words[num.length + 1] = 0;
  num.length += 2;

  var uhi = 0;
  var hi = 0;
  var lo = 0;
  for (var i = 0; i < num.length; i++) {
    var w = num.words[i];
    hi += w * 0x40;
    lo += w * 0x3d1;
    hi += (lo / 0x4000000) | 0;
    uhi += (hi / 0x4000000) | 0;
    hi &= 0x3ffffff;
    lo &= 0x3ffffff;

    num.words[i] = lo;

    lo = hi;
    hi = uhi;
    uhi = 0;
  }

  // Fast length reduction
  if (num.words[num.length - 1] === 0)
    num.length--;
  if (num.words[num.length - 1] === 0)
    num.length--;
  return num;
};

function P224() {
  MPrime.call(
    this,
    'p224',
    'ffffffff ffffffff ffffffff ffffffff 00000000 00000000 00000001');
}
inherits(P224, MPrime);

function P192() {
  MPrime.call(
    this,
    'p192',
    'ffffffff ffffffff ffffffff fffffffe ffffffff ffffffff');
}
inherits(P192, MPrime);

function P25519() {
  // 2 ^ 255 - 19
  MPrime.call(
    this,
    '25519',
    '7fffffffffffffff ffffffffffffffff ffffffffffffffff ffffffffffffffed');
}
inherits(P25519, MPrime);

P25519.prototype.imulK = function imulK(num) {
  // K = 0x13
  var carry = 0;
  for (var i = 0; i < num.length; i++) {
    var hi = num.words[i] * 0x13 + carry;
    var lo = hi & 0x3ffffff;
    hi >>>= 26;

    num.words[i] = lo;
    carry = hi;
  }
  if (carry !== 0)
    num.words[num.length++] = carry;
  return num;
};

// Exported mostly for testing purposes, use plain name instead
BN._prime = function prime(name) {
  // Cached version of prime
  if (primes[name])
    return primes[name];

  var prime;
  if (name === 'k256')
    prime = new K256();
  else if (name === 'p224')
    prime = new P224();
  else if (name === 'p192')
    prime = new P192();
  else if (name === 'p25519')
    prime = new P25519();
  else
    throw new Error('Unknown prime ' + name);
  primes[name] = prime;

  return prime;
}

//
// Base reduction engine
//
function Red(m) {
  if (typeof m === 'string') {
    var prime = BN._prime(m);
    this.m = prime.p;
    this.prime = prime;
  } else {
    this.m = m;
    this.prime = null;
  }
}

Red.prototype._verify1 = function _verify1(a) {
  assert(!a.sign, 'red works only with positives');
  assert(a.red, 'red works only with red numbers');
};

Red.prototype._verify2 = function _verify2(a, b) {
  assert(!a.sign && !b.sign, 'red works only with positives');
  assert(a.red && a.red === b.red,
         'red works only with red numbers');
};

Red.prototype.imod = function imod(a) {
  if (this.prime)
    return this.prime.ireduce(a)._forceRed(this);
  return a.mod(this.m)._forceRed(this);
};

Red.prototype.neg = function neg(a) {
  var r = a.clone();
  r.sign = !r.sign;
  return r.iadd(this.m)._forceRed(this);
};

Red.prototype.add = function add(a, b) {
  this._verify2(a, b);

  var res = a.add(b);
  if (res.cmp(this.m) >= 0)
    res.isub(this.m);
  return res._forceRed(this);
};

Red.prototype.iadd = function iadd(a, b) {
  this._verify2(a, b);

  var res = a.iadd(b);
  if (res.cmp(this.m) >= 0)
    res.isub(this.m);
  return res;
};

Red.prototype.sub = function sub(a, b) {
  this._verify2(a, b);

  var res = a.sub(b);
  if (res.cmpn(0) < 0)
    res.iadd(this.m);
  return res._forceRed(this);
};

Red.prototype.isub = function isub(a, b) {
  this._verify2(a, b);

  var res = a.isub(b);
  if (res.cmpn(0) < 0)
    res.iadd(this.m);
  return res;
};

Red.prototype.shl = function shl(a, num) {
  this._verify1(a);
  return this.imod(a.shln(num));
};

Red.prototype.imul = function imul(a, b) {
  this._verify2(a, b);
  return this.imod(a.imul(b));
};

Red.prototype.mul = function mul(a, b) {
  this._verify2(a, b);
  return this.imod(a.mul(b));
};

Red.prototype.isqr = function isqr(a) {
  return this.imul(a, a);
};

Red.prototype.sqr = function sqr(a) {
  return this.mul(a, a);
};

Red.prototype.sqrt = function sqrt(a) {
  if (a.cmpn(0) === 0)
    return a.clone();

  var mod3 = this.m.andln(3);
  assert(mod3 % 2 === 1);

  // Fast case
  if (mod3 === 3) {
    var pow = this.m.add(new BN(1)).ishrn(2);
    var r = this.pow(a, pow);
    return r;
  }

  // Tonelli-Shanks algorithm (Totally unoptimized and slow)
  //
  // Find Q and S, that Q * 2 ^ S = (P - 1)
  var q = this.m.subn(1);
  var s = 0;
  while (q.cmpn(0) !== 0 && q.andln(1) === 0) {
    s++;
    q.ishrn(1);
  }
  assert(q.cmpn(0) !== 0);

  var one = new BN(1).toRed(this);
  var nOne = one.redNeg();

  // Find quadratic non-residue
  // NOTE: Max is such because of generalized Riemann hypothesis.
  var lpow = this.m.subn(1).ishrn(1);
  var z = this.m.bitLength();
  z = new BN(2 * z * z).toRed(this);
  while (this.pow(z, lpow).cmp(nOne) !== 0)
    z.redIAdd(nOne);

  var c = this.pow(z, q);
  var r = this.pow(a, q.addn(1).ishrn(1));
  var t = this.pow(a, q);
  var m = s;
  while (t.cmp(one) !== 0) {
    var tmp = t;
    for (var i = 0; tmp.cmp(one) !== 0; i++)
      tmp = tmp.redSqr();
    assert(i < m);
    var b = this.pow(c, new BN(1).ishln(m - i - 1));

    r = r.redMul(b);
    c = b.redSqr();
    t = t.redMul(c);
    m = i;
  }

  return r;
};

Red.prototype.invm = function invm(a) {
  var inv = a._egcd(new BN(1), this.m);
  if (inv.sign) {
    inv.sign = false;
    return this.imod(inv).redNeg();
  } else {
    return this.imod(inv);
  }
};

Red.prototype.pow = function pow(a, num) {
  var w = [];
  var q = num.clone();
  while (q.cmpn(0) !== 0) {
    w.push(q.andln(1));
    q.ishrn(1);
  }

  // Skip leading zeroes
  var res = a;
  for (var i = 0; i < w.length; i++, res = this.sqr(res))
    if (w[i] !== 0)
      break;

  if (++i < w.length) {
    for (var q = this.sqr(res); i < w.length; i++, q = this.sqr(q)) {
      if (w[i] === 0)
        continue;
      res = this.mul(res, q);
    }
  }

  return res;
};

Red.prototype.convertTo = function convertTo(num) {
  return num.clone();
};

Red.prototype.convertFrom = function convertFrom(num) {
  var res = num.clone();
  res.red = null;
  return res;
};

//
// Montgomery method engine
//

BN.mont = function mont(num) {
  return new Mont(num);
};

function Mont(m) {
  Red.call(this, m);

  this.shift = this.m.bitLength();
  if (this.shift % 26 !== 0)
    this.shift += 26 - (this.shift % 26);
  this.r = new BN(1).ishln(this.shift);
  this.r2 = this.imod(this.r.sqr());
  this.rinv = this.r.invm(this.m);

  // TODO(indutny): simplify it
  this.minv = this.rinv.mul(this.r)
                       .sub(new BN(1))
                       .div(this.m)
                       .neg()
                       .mod(this.r);
}
inherits(Mont, Red);

Mont.prototype.convertTo = function convertTo(num) {
  return this.imod(num.shln(this.shift));
};

Mont.prototype.convertFrom = function convertFrom(num) {
  var r = this.imod(num.mul(this.rinv));
  r.red = null;
  return r;
};

Mont.prototype.imul = function imul(a, b) {
  if (a.cmpn(0) === 0 || b.cmpn(0) === 0) {
    a.words[0] = 0;
    a.length = 1;
    return a;
  }

  var t = a.imul(b);
  var c = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
  var u = t.isub(c).ishrn(this.shift);
  var res = u;
  if (u.cmp(this.m) >= 0)
    res = u.isub(this.m);
  else if (u.cmpn(0) < 0)
    res = u.iadd(this.m);

  return res._forceRed(this);
};

Mont.prototype.mul = function mul(a, b) {
  if (a.cmpn(0) === 0 || b.cmpn(0) === 0)
    return new BN(0)._forceRed(this);

  var t = a.mul(b);
  var c = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
  var u = t.isub(c).ishrn(this.shift);
  var res = u;
  if (u.cmp(this.m) >= 0)
    res = u.isub(this.m);
  else if (u.cmpn(0) < 0)
    res = u.iadd(this.m);

  return res._forceRed(this);
};

Mont.prototype.invm = function invm(a) {
  // (AR)^-1 * R^2 = (A^-1 * R^-1) * R^2 = A^-1 * R
  var res = this.imod(a.invm(this.m).mul(this.r2));
  return res._forceRed(this);
};

},{}],28:[function(require,module,exports){
(function (Buffer){
var bn = require('bn.js');
module.exports = crt;
function blind(priv, crypto) {
  var r = getr(priv, crypto);
  var blinder = r.toRed(bn.mont(priv.modulus))
  .redPow(new bn(priv.publicExponent)).fromRed();
  return {
    blinder: blinder,
    unblinder:r.invm(priv.modulus)
  };
}
function crt(msg, priv, crypto) {
  var blinds = blind(priv, crypto);
  var len = priv.modulus.byteLength();
  var mod = bn.mont(priv.modulus);
  var blinded = new bn(msg).mul(blinds.blinder).mod(priv.modulus);
  var c1 = blinded.toRed(bn.mont(priv.prime1));
  var c2 = blinded.toRed(bn.mont(priv.prime2));
  var qinv = priv.coefficient;
  var p = priv.prime1;
  var q = priv.prime2;
  var m1 = c1.redPow(priv.exponent1);
  var m2 = c2.redPow(priv.exponent2);
  m1 = m1.fromRed();
  m2 = m2.fromRed();
  var h = m1.isub(m2).imul(qinv).mod(p);
  h.imul(q);
  m2.iadd(h);
  var out = new Buffer(m2.imul(blinds.unblinder).mod(priv.modulus).toArray());
  if (out.length < len) {
    var prefix = new Buffer(len - out.length);
    prefix.fill(0);
    out = Buffer.concat([prefix, out], len);
  }
  return out;
}
crt.getr = getr;
function getr(priv, crypto) {
  var len = priv.modulus.byteLength();
  var r = new bn(crypto.randomBytes(len));
  while (r.cmp(priv.modulus) >=  0 || !r.mod(priv.prime1) || !r.mod(priv.prime2)) {
    r = new bn(crypto.randomBytes(len));
  }
  return r;
}
}).call(this,require("buffer").Buffer)
},{"bn.js":27,"buffer":"buffer"}],29:[function(require,module,exports){
var elliptic = exports;

elliptic.version = require('../package.json').version;
elliptic.utils = require('./elliptic/utils');
elliptic.rand = require('brorand');
elliptic.hmacDRBG = require('./elliptic/hmac-drbg');
elliptic.curve = require('./elliptic/curve');
elliptic.curves = require('./elliptic/curves');

// Protocols
elliptic.ec = require('./elliptic/ec');

},{"../package.json":48,"./elliptic/curve":32,"./elliptic/curves":35,"./elliptic/ec":36,"./elliptic/hmac-drbg":39,"./elliptic/utils":40,"brorand":41}],30:[function(require,module,exports){
var bn = require('bn.js');
var elliptic = require('../../elliptic');

var getNAF = elliptic.utils.getNAF;
var getJSF = elliptic.utils.getJSF;
var assert = elliptic.utils.assert;

function BaseCurve(type, conf) {
  this.type = type;
  this.p = new bn(conf.p, 16);

  // Use Montgomery, when there is no fast reduction for the prime
  this.red = conf.prime ? bn.red(conf.prime) : bn.mont(this.p);

  // Useful for many curves
  this.zero = new bn(0).toRed(this.red);
  this.one = new bn(1).toRed(this.red);
  this.two = new bn(2).toRed(this.red);

  // Curve configuration, optional
  this.n = conf.n && new bn(conf.n, 16);
  this.g = conf.g && this.pointFromJSON(conf.g, conf.gRed);

  // Temporary arrays
  this._wnafT1 = new Array(4);
  this._wnafT2 = new Array(4);
  this._wnafT3 = new Array(4);
  this._wnafT4 = new Array(4);
}
module.exports = BaseCurve;

BaseCurve.prototype.point = function point() {
  throw new Error('Not implemented');
};

BaseCurve.prototype.validate = function validate(point) {
  throw new Error('Not implemented');
};

BaseCurve.prototype._fixedNafMul = function _fixedNafMul(p, k) {
  var doubles = p._getDoubles();

  var naf = getNAF(k, 1);
  var I = (1 << (doubles.step + 1)) - (doubles.step % 2 === 0 ? 2 : 1);
  I /= 3;

  // Translate into more windowed form
  var repr = [];
  for (var j = 0; j < naf.length; j += doubles.step) {
    var nafW = 0;
    for (var k = j + doubles.step - 1; k >= j; k--)
      nafW = (nafW << 1) + naf[k];
    repr.push(nafW);
  }

  var a = this.jpoint(null, null, null);
  var b = this.jpoint(null, null, null);
  for (var i = I; i > 0; i--) {
    for (var j = 0; j < repr.length; j++) {
      var nafW = repr[j];
      if (nafW === i)
        b = b.mixedAdd(doubles.points[j]);
      else if (nafW === -i)
        b = b.mixedAdd(doubles.points[j].neg());
    }
    a = a.add(b);
  }
  return a.toP();
};

BaseCurve.prototype._wnafMul = function _wnafMul(p, k) {
  var w = 4;

  // Precompute window
  var nafPoints = p._getNAFPoints(w);
  w = nafPoints.wnd;
  var wnd = nafPoints.points;

  // Get NAF form
  var naf = getNAF(k, w);

  // Add `this`*(N+1) for every w-NAF index
  var acc = this.jpoint(null, null, null);
  for (var i = naf.length - 1; i >= 0; i--) {
    // Count zeroes
    for (var k = 0; i >= 0 && naf[i] === 0; i--)
      k++;
    if (i >= 0)
      k++;
    acc = acc.dblp(k);

    if (i < 0)
      break;
    var z = naf[i];
    assert(z !== 0);
    if (p.type === 'affine') {
      // J +- P
      if (z > 0)
        acc = acc.mixedAdd(wnd[(z - 1) >> 1]);
      else
        acc = acc.mixedAdd(wnd[(-z - 1) >> 1].neg());
    } else {
      // J +- J
      if (z > 0)
        acc = acc.add(wnd[(z - 1) >> 1]);
      else
        acc = acc.add(wnd[(-z - 1) >> 1].neg());
    }
  }
  return p.type === 'affine' ? acc.toP() : acc;
};

BaseCurve.prototype._wnafMulAdd = function _wnafMulAdd(defW,
                                                       points,
                                                       coeffs,
                                                       len) {
  var wndWidth = this._wnafT1;
  var wnd = this._wnafT2;
  var naf = this._wnafT3;

  // Fill all arrays
  var max = 0;
  for (var i = 0; i < len; i++) {
    var p = points[i];
    var nafPoints = p._getNAFPoints(defW);
    wndWidth[i] = nafPoints.wnd;
    wnd[i] = nafPoints.points;
  }

  // Comb small window NAFs
  for (var i = len - 1; i >= 1; i -= 2) {
    var a = i - 1;
    var b = i;
    if (wndWidth[a] !== 1 || wndWidth[b] !== 1) {
      naf[a] = getNAF(coeffs[a], wndWidth[a]);
      naf[b] = getNAF(coeffs[b], wndWidth[b]);
      max = Math.max(naf[a].length, max);
      max = Math.max(naf[b].length, max);
      continue;
    }

    var comb = [
      points[a], /* 1 */
      null, /* 3 */
      null, /* 5 */
      points[b] /* 7 */
    ];

    // Try to avoid Projective points, if possible
    if (points[a].y.cmp(points[b].y) === 0) {
      comb[1] = points[a].add(points[b]);
      comb[2] = points[a].toJ().mixedAdd(points[b].neg());
    } else if (points[a].y.cmp(points[b].y.redNeg()) === 0) {
      comb[1] = points[a].toJ().mixedAdd(points[b]);
      comb[2] = points[a].add(points[b].neg());
    } else {
      comb[1] = points[a].toJ().mixedAdd(points[b]);
      comb[2] = points[a].toJ().mixedAdd(points[b].neg());
    }

    var index = [
      -3, /* -1 -1 */
      -1, /* -1 0 */
      -5, /* -1 1 */
      -7, /* 0 -1 */
      0, /* 0 0 */
      7, /* 0 1 */
      5, /* 1 -1 */
      1, /* 1 0 */
      3  /* 1 1 */
    ];

    var jsf = getJSF(coeffs[a], coeffs[b]);
    max = Math.max(jsf[0].length, max);
    naf[a] = new Array(max);
    naf[b] = new Array(max);
    for (var j = 0; j < max; j++) {
      var ja = jsf[0][j] | 0;
      var jb = jsf[1][j] | 0;

      naf[a][j] = index[(ja + 1) * 3 + (jb + 1)];
      naf[b][j] = 0;
      wnd[a] = comb;
    }
  }

  var acc = this.jpoint(null, null, null);
  var tmp = this._wnafT4;
  for (var i = max; i >= 0; i--) {
    var k = 0;

    while (i >= 0) {
      var zero = true;
      for (var j = 0; j < len; j++) {
        tmp[j] = naf[j][i] | 0;
        if (tmp[j] !== 0)
          zero = false;
      }
      if (!zero)
        break;
      k++;
      i--;
    }
    if (i >= 0)
      k++;
    acc = acc.dblp(k);
    if (i < 0)
      break;

    for (var j = 0; j < len; j++) {
      var z = tmp[j];
      var p;
      if (z === 0)
        continue;
      else if (z > 0)
        p = wnd[j][(z - 1) >> 1];
      else if (z < 0)
        p = wnd[j][(-z - 1) >> 1].neg();

      if (p.type === 'affine')
        acc = acc.mixedAdd(p);
      else
        acc = acc.add(p);
    }
  }
  // Zeroify references
  for (var i = 0; i < len; i++)
    wnd[i] = null;
  return acc.toP();
};

BaseCurve.BasePoint = BasePoint;

function BasePoint(curve, type) {
  this.curve = curve;
  this.type = type;
  this.precomputed = null;
}

BasePoint.prototype.validate = function validate() {
  return this.curve.validate(this);
};

BasePoint.prototype.precompute = function precompute(power, _beta) {
  if (this.precomputed)
    return this;

  var precomputed = {
    doubles: null,
    naf: null,
    beta: null
  };
  precomputed.naf = this._getNAFPoints(8);
  precomputed.doubles = this._getDoubles(4, power);
  precomputed.beta = this._getBeta();
  this.precomputed = precomputed;

  return this;
};

BasePoint.prototype._getDoubles = function _getDoubles(step, power) {
  if (this.precomputed && this.precomputed.doubles)
    return this.precomputed.doubles;

  var doubles = [ this ];
  var acc = this;
  for (var i = 0; i < power; i += step) {
    for (var j = 0; j < step; j++)
      acc = acc.dbl();
    doubles.push(acc);
  }
  return {
    step: step,
    points: doubles
  };
};

BasePoint.prototype._getNAFPoints = function _getNAFPoints(wnd) {
  if (this.precomputed && this.precomputed.naf)
    return this.precomputed.naf;

  var res = [ this ];
  var max = (1 << wnd) - 1;
  var dbl = max === 1 ? null : this.dbl();
  for (var i = 1; i < max; i++)
    res[i] = res[i - 1].add(dbl);
  return {
    wnd: wnd,
    points: res
  };
};

BasePoint.prototype._getBeta = function _getBeta() {
  return null;
};

BasePoint.prototype.dblp = function dblp(k) {
  var r = this;
  for (var i = 0; i < k; i++)
    r = r.dbl();
  return r;
};

},{"../../elliptic":29,"bn.js":27}],31:[function(require,module,exports){
var curve = require('../curve');
var elliptic = require('../../elliptic');
var bn = require('bn.js');
var inherits = require('inherits');
var Base = curve.base;

var getNAF = elliptic.utils.getNAF;
var assert = elliptic.utils.assert;

function EdwardsCurve(conf) {
  // NOTE: Important as we are creating point in Base.call()
  this.twisted = conf.a != 1;
  this.mOneA = this.twisted && conf.a == -1;
  this.extended = this.mOneA;

  Base.call(this, 'mont', conf);

  this.a = new bn(conf.a, 16).mod(this.red.m).toRed(this.red);
  this.c = new bn(conf.c, 16).toRed(this.red);
  this.c2 = this.c.redSqr();
  this.d = new bn(conf.d, 16).toRed(this.red);
  this.dd = this.d.redAdd(this.d);

  assert(!this.twisted || this.c.fromRed().cmpn(1) === 0);
  this.oneC = conf.c == 1;
}
inherits(EdwardsCurve, Base);
module.exports = EdwardsCurve;

EdwardsCurve.prototype._mulA = function _mulA(num) {
  if (this.mOneA)
    return num.redNeg();
  else
    return this.a.redMul(num);
};

EdwardsCurve.prototype._mulC = function _mulC(num) {
  if (this.oneC)
    return num;
  else
    return this.c.redMul(num);
};

EdwardsCurve.prototype.point = function point(x, y, z, t) {
  return new Point(this, x, y, z, t);
};

// Just for compatibility with Short curve
EdwardsCurve.prototype.jpoint = function jpoint(x, y, z, t) {
  return this.point(x, y, z, t);
};

EdwardsCurve.prototype.pointFromJSON = function pointFromJSON(obj) {
  return Point.fromJSON(this, obj);
};

EdwardsCurve.prototype.pointFromX = function pointFromX(odd, x) {
  x = new bn(x, 16);
  if (!x.red)
    x = x.toRed(this.red);

  var x2 = x.redSqr();
  var rhs = this.c2.redSub(this.a.redMul(x2));
  var lhs = this.one.redSub(this.c2.redMul(this.d).redMul(x2));

  var y = rhs.redMul(lhs.redInvm()).redSqrt();
  var isOdd = y.fromRed().isOdd();
  if (odd && !isOdd || !odd && isOdd)
    y = y.redNeg();

  return this.point(x, y, curve.one);
};

EdwardsCurve.prototype.validate = function validate(point) {
  if (point.isInfinity())
    return true;

  // Curve: A * X^2 + Y^2 = C^2 * (1 + D * X^2 * Y^2)
  point.normalize();

  var x2 = point.x.redSqr();
  var y2 = point.y.redSqr();
  var lhs = x2.redMul(this.a).redAdd(y2);
  var rhs = this.c2.redMul(this.one.redAdd(this.d.redMul(x2).redMul(y2)));

  return lhs.cmp(rhs) === 0;
};

function Point(curve, x, y, z, t) {
  Base.BasePoint.call(this, curve, 'projective');
  if (x === null && y === null && z === null) {
    this.x = this.curve.zero;
    this.y = this.curve.one;
    this.z = this.curve.one;
    this.t = this.curve.zero;
    this.zOne = true;
  } else {
    this.x = new bn(x, 16);
    this.y = new bn(y, 16);
    this.z = z ? new bn(z, 16) : this.curve.one;
    this.t = t && new bn(t, 16);
    if (!this.x.red)
      this.x = this.x.toRed(this.curve.red);
    if (!this.y.red)
      this.y = this.y.toRed(this.curve.red);
    if (!this.z.red)
      this.z = this.z.toRed(this.curve.red);
    if (this.t && !this.t.red)
      this.t = this.t.toRed(this.curve.red);
    this.zOne = this.z === this.curve.one;

    // Use extended coordinates
    if (this.curve.extended && !this.t) {
      this.t = this.x.redMul(this.y);
      if (!this.zOne)
        this.t = this.t.redMul(this.z.redInvm());
    }
  }
}
inherits(Point, Base.BasePoint);

Point.fromJSON = function fromJSON(curve, obj) {
  return new Point(curve, obj[0], obj[1], obj[2]);
};

Point.prototype.inspect = function inspect() {
  if (this.isInfinity())
    return '<EC Point Infinity>';
  return '<EC Point x: ' + this.x.fromRed().toString(16, 2) +
      ' y: ' + this.y.fromRed().toString(16, 2) +
      ' z: ' + this.z.fromRed().toString(16, 2) + '>';
};

Point.prototype.isInfinity = function isInfinity() {
  // XXX This code assumes that zero is always zero in red
  return this.x.cmpn(0) === 0 &&
         this.y.cmp(this.z) === 0;
};

Point.prototype._extDbl = function _extDbl() {
  // http://hyperelliptic.org/EFD/g1p/auto-twisted-extended-1.html#doubling-dbl-2008-hwcd
  // 4M + 4S

  // A = X1^2
  var a = this.x.redSqr();
  // B = Y1^2
  var b = this.y.redSqr();
  // C = 2 * Z1^2
  var c = this.z.redSqr();
  c = c.redIAdd(c);
  // D = a * A
  var d = this.curve._mulA(a);
  // E = (X1 + Y1)^2 - A - B
  var e = this.x.redAdd(this.y).redSqr().redISub(a).redISub(b);
  // G = D + B
  var g = d.redAdd(b);
  // F = G - C
  var f = g.redSub(c);
  // H = D - B
  var h = d.redSub(b);
  // X3 = E * F
  var nx = e.redMul(f);
  // Y3 = G * H
  var ny = g.redMul(h);
  // T3 = E * H
  var nt = e.redMul(h);
  // Z3 = F * G
  var nz = f.redMul(g);
  return this.curve.point(nx, ny, nz, nt);
};

Point.prototype._projDbl = function _projDbl() {
  // http://hyperelliptic.org/EFD/g1p/auto-twisted-projective.html#doubling-dbl-2008-bbjlp
  // http://hyperelliptic.org/EFD/g1p/auto-edwards-projective.html#doubling-dbl-2007-bl
  // and others
  // Generally 3M + 4S or 2M + 4S

  // B = (X1 + Y1)^2
  var b = this.x.redAdd(this.y).redSqr();
  // C = X1^2
  var c = this.x.redSqr();
  // D = Y1^2
  var d = this.y.redSqr();

  if (this.curve.twisted) {
    // E = a * C
    var e = this.curve._mulA(c);
    // F = E + D
    var f = e.redAdd(d);
    if (this.zOne) {
      // X3 = (B - C - D) * (F - 2)
      var nx = b.redSub(c).redSub(d).redMul(f.redSub(this.curve.two));
      // Y3 = F * (E - D)
      var ny = f.redMul(e.redSub(d));
      // Z3 = F^2 - 2 * F
      var nz = f.redSqr().redSub(f).redSub(f);
    } else {
      // H = Z1^2
      var h = this.z.redSqr();
      // J = F - 2 * H
      var j = f.redSub(h).redISub(h);
      // X3 = (B-C-D)*J
      var nx = b.redSub(c).redISub(d).redMul(j);
      // Y3 = F * (E - D)
      var ny = f.redMul(e.redSub(d));
      // Z3 = F * J
      var nz = f.redMul(j);
    }
  } else {
    // E = C + D
    var e = c.redAdd(d);
    // H = (c * Z1)^2
    var h = this.curve._mulC(redMul(this.z)).redSqr();
    // J = E - 2 * H
    var j = e.redSub(h).redSub(h);
    // X3 = c * (B - E) * J
    var nx = this.curve._mulC(b.redISub(e)).redMul(j);
    // Y3 = c * E * (C - D)
    var ny = this.curve._mulC(e).redMul(c.redISub(d));
    // Z3 = E * J
    var nz = e.redMul(j);
  }
  return this.curve.point(nx, ny, nz);
};

Point.prototype.dbl = function dbl() {
  if (this.isInfinity())
    return this;

  // Double in extended coordinates
  if (this.curve.extended)
    return this._extDbl();
  else
    return this._projDbl();
};

Point.prototype._extAdd = function _extAdd(p) {
  // http://hyperelliptic.org/EFD/g1p/auto-twisted-extended-1.html#addition-add-2008-hwcd-3
  // 8M

  // A = (Y1 - X1) * (Y2 - X2)
  var a = this.y.redSub(this.x).redMul(p.y.redSub(p.x));
  // B = (Y1 + X1) * (Y2 + X2)
  var b = this.y.redAdd(this.x).redMul(p.y.redAdd(p.x));
  // C = T1 * k * T2
  var c = this.t.redMul(this.curve.dd).redMul(p.t);
  // D = Z1 * 2 * Z2
  var d = this.z.redMul(p.z.redAdd(p.z));
  // E = B - A
  var e = b.redSub(a);
  // F = D - C
  var f = d.redSub(c);
  // G = D + C
  var g = d.redAdd(c);
  // H = B + A
  var h = b.redAdd(a);
  // X3 = E * F
  var nx = e.redMul(f);
  // Y3 = G * H
  var ny = g.redMul(h);
  // T3 = E * H
  var nt = e.redMul(h);
  // Z3 = F * G
  var nz = f.redMul(g);
  return this.curve.point(nx, ny, nz, nt);
};

Point.prototype._projAdd = function _projAdd(p) {
  // http://hyperelliptic.org/EFD/g1p/auto-twisted-projective.html#addition-add-2008-bbjlp
  // http://hyperelliptic.org/EFD/g1p/auto-edwards-projective.html#addition-add-2007-bl
  // 10M + 1S

  // A = Z1 * Z2
  var a = this.z.redMul(p.z);
  // B = A^2
  var b = a.redSqr();
  // C = X1 * X2
  var c = this.x.redMul(p.x);
  // D = Y1 * Y2
  var d = this.y.redMul(p.y);
  // E = d * C * D
  var e = this.curve.d.redMul(c).redMul(d);
  // F = B - E
  var f = b.redSub(e);
  // G = B + E
  var g = b.redAdd(e);
  // X3 = A * F * ((X1 + Y1) * (X2 + Y2) - C - D)
  var tmp = this.x.redAdd(this.y).redMul(p.x.redAdd(p.y)).redISub(c).redISub(d);
  var nx = a.redMul(f).redMul(tmp);
  if (this.curve.twisted) {
    // Y3 = A * G * (D - a * C)
    var ny = a.redMul(g).redMul(d.redSub(this.curve._mulA(c)));
    // Z3 = F * G
    var nz = f.redMul(g);
  } else {
    // Y3 = A * G * (D - C)
    var ny = a.redMul(g).redMul(d.redSub(c));
    // Z3 = c * F * G
    var nz = this.curve._mulC(f).redMul(g);
  }
  return this.curve.point(nx, ny, nz);
};

Point.prototype.add = function add(p) {
  if (this.isInfinity())
    return p;
  if (p.isInfinity())
    return this;

  if (this.curve.extended)
    return this._extAdd(p);
  else
    return this._projAdd(p);
};

Point.prototype.mul = function mul(k) {
  if (this.precomputed && this.precomputed.doubles)
    return this.curve._fixedNafMul(this, k);
  else
    return this.curve._wnafMul(this, k);
};

Point.prototype.mulAdd = function mulAdd(k1, p, k2) {
  return this.curve._wnafMulAdd(1, [ this, p ], [ k1, k2 ], 2);
};

Point.prototype.normalize = function normalize() {
  if (this.zOne)
    return this;

  // Normalize coordinates
  var zi = this.z.redInvm();
  this.x = this.x.redMul(zi);
  this.y = this.y.redMul(zi);
  if (this.t)
    this.t = this.t.redMul(zi);
  this.z = this.curve.one;
  this.zOne = true;
  return this;
};

Point.prototype.neg = function neg() {
  return this.curve.point(this.x.redNeg(),
                          this.y,
                          this.z,
                          this.t && this.t.redNeg());
};

Point.prototype.getX = function getX() {
  this.normalize();
  return this.x.fromRed();
};

Point.prototype.getY = function getY() {
  this.normalize();
  return this.y.fromRed();
};

// Compatibility with BaseCurve
Point.prototype.toP = Point.prototype.normalize;
Point.prototype.mixedAdd = Point.prototype.add;

},{"../../elliptic":29,"../curve":32,"bn.js":27,"inherits":143}],32:[function(require,module,exports){
var curve = exports;

curve.base = require('./base');
curve.short = require('./short');
curve.mont = require('./mont');
curve.edwards = require('./edwards');

},{"./base":30,"./edwards":31,"./mont":33,"./short":34}],33:[function(require,module,exports){
var curve = require('../curve');
var elliptic = require('../../elliptic');
var bn = require('bn.js');
var inherits = require('inherits');
var Base = curve.base;

var getNAF = elliptic.utils.getNAF;
var assert = elliptic.utils.assert;

function MontCurve(conf) {
  Base.call(this, 'mont', conf);

  this.a = new bn(conf.a, 16).toRed(this.red);
  this.b = new bn(conf.b, 16).toRed(this.red);
  this.i4 = new bn(4).toRed(this.red).redInvm();
  this.two = new bn(2).toRed(this.red);
  this.a24 = this.i4.redMul(this.a.redAdd(this.two));
}
inherits(MontCurve, Base);
module.exports = MontCurve;

MontCurve.prototype.point = function point(x, z) {
  return new Point(this, x, z);
};

MontCurve.prototype.pointFromJSON = function pointFromJSON(obj) {
  return Point.fromJSON(this, obj);
}

MontCurve.prototype.validate = function validate(point) {
  var x = point.normalize().x;
  var x2 = x.redSqr();
  var rhs = x2.redMul(x).redAdd(x2.redMul(this.a)).redAdd(x);
  var y = rhs.redSqrt();

  return y.redSqr().cmp(rhs) === 0;
};

function Point(curve, x, z) {
  Base.BasePoint.call(this, curve, 'projective');
  if (x === null && z === null) {
    this.x = this.curve.one;
    this.z = this.curve.zero;
  } else {
    this.x = new bn(x, 16);
    this.z = new bn(z, 16);
    if (!this.x.red)
      this.x = this.x.toRed(this.curve.red);
    if (!this.z.red)
      this.z = this.z.toRed(this.curve.red);
  }
}
inherits(Point, Base.BasePoint);

Point.prototype.precompute = function precompute() {
  // No-op
};

Point.fromJSON = function fromJSON(curve, obj) {
  return new Point(curve, obj[0], obj[1] || curve.one);
};

Point.prototype.inspect = function inspect() {
  if (this.isInfinity())
    return '<EC Point Infinity>';
  return '<EC Point x: ' + this.x.fromRed().toString(16, 2) +
      ' z: ' + this.z.fromRed().toString(16, 2) + '>';
};

Point.prototype.isInfinity = function isInfinity() {
  // XXX This code assumes that zero is always zero in red
  return this.z.cmpn(0) === 0;
};

Point.prototype.dbl = function dbl() {
  // http://hyperelliptic.org/EFD/g1p/auto-montgom-xz.html#doubling-dbl-1987-m-3
  // 2M + 2S + 4A

  // A = X1 + Z1
  var a = this.x.redAdd(this.z);
  // AA = A^2
  var aa = a.redSqr();
  // B = X1 - Z1
  var b = this.x.redSub(this.z);
  // BB = B^2
  var bb = b.redSqr();
  // C = AA - BB
  var c = aa.redSub(bb);
  // X3 = AA * BB
  var nx = aa.redMul(bb);
  // Z3 = C * (BB + A24 * C)
  var nz = c.redMul(bb.redAdd(this.curve.a24.redMul(c)));
  return this.curve.point(nx, nz);
};

Point.prototype.add = function add(p) {
  throw new Error('Not supported on Montgomery curve');
};

Point.prototype.diffAdd = function diffAdd(p, diff) {
  // http://hyperelliptic.org/EFD/g1p/auto-montgom-xz.html#diffadd-dadd-1987-m-3
  // 4M + 2S + 6A

  // A = X2 + Z2
  var a = this.x.redAdd(this.z);
  // B = X2 - Z2
  var b = this.x.redSub(this.z);
  // C = X3 + Z3
  var c = p.x.redAdd(p.z);
  // D = X3 - Z3
  var d = p.x.redSub(p.z);
  // DA = D * A
  var da = d.redMul(a);
  // CB = C * B
  var cb = c.redMul(b);
  // X5 = Z1 * (DA + CB)^2
  var nx = diff.z.redMul(da.redAdd(cb).redSqr());
  // Z5 = X1 * (DA - CB)^2
  var nz = diff.x.redMul(da.redISub(cb).redSqr());
  return this.curve.point(nx, nz);
};

Point.prototype.mul = function mul(k) {
  var t = k.clone();
  var a = this; // (N / 2) * Q + Q
  var b = this.curve.point(null, null); // (N / 2) * Q
  var c = this; // Q

  for (var bits = []; t.cmpn(0) !== 0; t.ishrn(1))
    bits.push(t.andln(1));

  for (var i = bits.length - 1; i >= 0; i--) {
    if (bits[i] === 0) {
      // N * Q + Q = ((N / 2) * Q + Q)) + (N / 2) * Q
      a = a.diffAdd(b, c);
      // N * Q = 2 * ((N / 2) * Q + Q))
      b = b.dbl();
    } else {
      // N * Q = ((N / 2) * Q + Q) + ((N / 2) * Q)
      b = a.diffAdd(b, c);
      // N * Q + Q = 2 * ((N / 2) * Q + Q)
      a = a.dbl();
    }
  }
  return b;
};

Point.prototype.mulAdd = function mulAdd() {
  throw new Error('Not supported on Montgomery curve');
};

Point.prototype.normalize = function normalize() {
  this.x = this.x.redMul(this.z.redInvm());
  this.z = this.curve.one;
  return this;
};

Point.prototype.getX = function getX() {
  // Normalize coordinates
  this.normalize();

  return this.x.fromRed();
};

},{"../../elliptic":29,"../curve":32,"bn.js":27,"inherits":143}],34:[function(require,module,exports){
var curve = require('../curve');
var elliptic = require('../../elliptic');
var bn = require('bn.js');
var inherits = require('inherits');
var Base = curve.base;

var getNAF = elliptic.utils.getNAF;
var assert = elliptic.utils.assert;

function ShortCurve(conf) {
  Base.call(this, 'short', conf);

  this.a = new bn(conf.a, 16).toRed(this.red);
  this.b = new bn(conf.b, 16).toRed(this.red);
  this.tinv = this.two.redInvm();

  this.zeroA = this.a.fromRed().cmpn(0) === 0;
  this.threeA = this.a.fromRed().sub(this.p).cmpn(-3) === 0;

  // If the curve is endomorphic, precalculate beta and lambda
  this.endo = this._getEndomorphism(conf);
  this._endoWnafT1 = new Array(4);
  this._endoWnafT2 = new Array(4);
}
inherits(ShortCurve, Base);
module.exports = ShortCurve;

ShortCurve.prototype._getEndomorphism = function _getEndomorphism(conf) {
  // No efficient endomorphism
  if (!this.zeroA || !this.g || !this.n || this.p.modn(3) !== 1)
    return;

  // Compute beta and lambda, that lambda * P = (beta * Px; Py)
  var beta;
  var lambda;
  if (conf.beta) {
    beta = new bn(conf.beta, 16).toRed(this.red);
  } else {
    var betas = this._getEndoRoots(this.p);
    // Choose the smallest beta
    beta = betas[0].cmp(betas[1]) < 0 ? betas[0] : betas[1];
    beta = beta.toRed(this.red);
  }
  if (conf.lambda) {
    lambda = new bn(conf.lambda, 16);
  } else {
    // Choose the lambda that is matching selected beta
    var lambdas = this._getEndoRoots(this.n);
    if (this.g.mul(lambdas[0]).x.cmp(this.g.x.redMul(beta)) === 0) {
      lambda = lambdas[0];
    } else {
      lambda = lambdas[1];
      assert(this.g.mul(lambda).x.cmp(this.g.x.redMul(beta)) === 0);
    }
  }

  // Get basis vectors, used for balanced length-two representation
  var basis;
  if (conf.basis) {
    basis = conf.basis.map(function(vec) {
      return {
        a: new bn(vec.a, 16),
        b: new bn(vec.b, 16),
      };
    });
  } else {
    basis = this._getEndoBasis(lambda);
  }

  return {
    beta: beta,
    lambda: lambda,
    basis: basis
  };
};

ShortCurve.prototype._getEndoRoots = function _getEndoRoots(num) {
  // Find roots of for x^2 + x + 1 in F
  // Root = (-1 +- Sqrt(-3)) / 2
  //
  var red = num === this.p ? this.red : bn.mont(num);
  var tinv = new bn(2).toRed(red).redInvm();
  var ntinv = tinv.redNeg();
  var one = new bn(1).toRed(red);

  var s = new bn(3).toRed(red).redNeg().redSqrt().redMul(tinv);

  var l1 = ntinv.redAdd(s).fromRed();
  var l2 = ntinv.redSub(s).fromRed();
  return [ l1, l2 ];
};

ShortCurve.prototype._getEndoBasis = function _getEndoBasis(lambda) {
  // aprxSqrt >= sqrt(this.n)
  var aprxSqrt = this.n.shrn(Math.floor(this.n.bitLength() / 2));

  // 3.74
  // Run EGCD, until r(L + 1) < aprxSqrt
  var u = lambda;
  var v = this.n.clone();
  var x1 = new bn(1);
  var y1 = new bn(0);
  var x2 = new bn(0);
  var y2 = new bn(1);

  // NOTE: all vectors are roots of: a + b * lambda = 0 (mod n)
  var a0;
  var b0;
  // First vector
  var a1;
  var b1;
  // Second vector
  var a2;
  var b2;

  var prevR;
  var i = 0;
  while (u.cmpn(0) !== 0) {
    var q = v.div(u);
    var r = v.sub(q.mul(u));
    var x = x2.sub(q.mul(x1));
    var y = y2.sub(q.mul(y1));

    if (!a1 && r.cmp(aprxSqrt) < 0) {
      a0 = prevR.neg();
      b0 = x1;
      a1 = r.neg();
      b1 = x;
    } else if (a1 && ++i === 2) {
      break;
    }
    prevR = r;

    v = u;
    u = r;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  a2 = r.neg();
  b2 = x;

  var len1 = a1.sqr().add(b1.sqr());
  var len2 = a2.sqr().add(b2.sqr());
  if (len2.cmp(len1) >= 0) {
    a2 = a0;
    b2 = b0;
  }

  // Normalize signs
  if (a1.sign) {
    a1 = a1.neg();
    b1 = b1.neg();
  }
  if (a2.sign) {
    a2 = a2.neg();
    b2 = b2.neg();
  }

  return [
    { a: a1, b: b1 },
    { a: a2, b: b2 }
  ];
};

ShortCurve.prototype._endoSplit = function _endoSplit(k) {
  var basis = this.endo.basis;
  var v1 = basis[0];
  var v2 = basis[1];

  var c1 = v2.b.mul(k).divRound(this.n);
  var c2 = v1.b.neg().mul(k).divRound(this.n);

  var p1 = c1.mul(v1.a);
  var p2 = c2.mul(v2.a);
  var q1 = c1.mul(v1.b);
  var q2 = c2.mul(v2.b);

  // Calculate answer
  var k1 = k.sub(p1).sub(p2);
  var k2 = q1.add(q2).neg();
  return { k1: k1, k2: k2 };
};

ShortCurve.prototype.point = function point(x, y, isRed) {
  return new Point(this, x, y, isRed);
};

ShortCurve.prototype.pointFromX = function pointFromX(odd, x) {
  x = new bn(x, 16);
  if (!x.red)
    x = x.toRed(this.red);

  var y2 = x.redSqr().redMul(x).redIAdd(x.redMul(this.a)).redIAdd(this.b);
  var y = y2.redSqrt();

  // XXX Is there any way to tell if the number is odd without converting it
  // to non-red form?
  var isOdd = y.fromRed().isOdd();
  if (odd && !isOdd || !odd && isOdd)
    y = y.redNeg();

  return this.point(x, y);
};

ShortCurve.prototype.jpoint = function jpoint(x, y, z) {
  return new JPoint(this, x, y, z);
};

ShortCurve.prototype.pointFromJSON = function pointFromJSON(obj, red) {
  return Point.fromJSON(this, obj, red);
};

ShortCurve.prototype.validate = function validate(point) {
  if (point.inf)
    return true;

  var x = point.x;
  var y = point.y;

  var ax = this.a.redMul(x);
  var rhs = x.redSqr().redMul(x).redIAdd(ax).redIAdd(this.b);
  return y.redSqr().redISub(rhs).cmpn(0) === 0;
};

ShortCurve.prototype._endoWnafMulAdd = function _endoWnafMulAdd(points, coeffs) {
  var npoints = this._endoWnafT1;
  var ncoeffs = this._endoWnafT2;
  for (var i = 0; i < points.length; i++) {
    var split = this._endoSplit(coeffs[i]);
    var p = points[i];
    var beta = p._getBeta();

    if (split.k1.sign) {
      split.k1.sign = !split.k1.sign;
      p = p.neg(true);
    }
    if (split.k2.sign) {
      split.k2.sign = !split.k2.sign;
      beta = beta.neg(true);
    }

    npoints[i * 2] = p;
    npoints[i * 2 + 1] = beta;
    ncoeffs[i * 2] = split.k1;
    ncoeffs[i * 2 + 1] = split.k2;
  }
  var res = this._wnafMulAdd(1, npoints, ncoeffs, i * 2);

  // Clean-up references to points and coefficients
  for (var j = 0; j < i * 2; j++) {
    npoints[j] = null;
    ncoeffs[j] = null;
  }
  return res;
};

function Point(curve, x, y, isRed) {
  Base.BasePoint.call(this, curve, 'affine');
  if (x === null && y === null) {
    this.x = null;
    this.y = null;
    this.inf = true;
  } else {
    this.x = new bn(x, 16);
    this.y = new bn(y, 16);
    // Force redgomery representation when loading from JSON
    if (isRed) {
      this.x.forceRed(this.curve.red);
      this.y.forceRed(this.curve.red);
    }
    if (!this.x.red)
      this.x = this.x.toRed(this.curve.red);
    if (!this.y.red)
      this.y = this.y.toRed(this.curve.red);
    this.inf = false;
  }
}
inherits(Point, Base.BasePoint);

Point.prototype._getBeta = function _getBeta() {
  if (!this.curve.endo)
    return;

  var pre = this.precomputed;
  if (pre && pre.beta)
    return pre.beta;

  var beta = this.curve.point(this.x.redMul(this.curve.endo.beta), this.y);
  if (pre) {
    var curve = this.curve;
    function endoMul(p) {
      return curve.point(p.x.redMul(curve.endo.beta), p.y);
    }
    pre.beta = beta;
    beta.precomputed = {
      beta: null,
      naf: pre.naf && {
        wnd: pre.naf.wnd,
        points: pre.naf.points.map(endoMul)
      },
      doubles: pre.doubles && {
        step: pre.doubles.step,
        points: pre.doubles.points.map(endoMul)
      }
    };
  }
  return beta;
};

Point.prototype.toJSON = function toJSON() {
  if (!this.precomputed)
    return [ this.x, this.y ];

  return [ this.x, this.y, this.precomputed && {
    doubles: this.precomputed.doubles && {
      step: this.precomputed.doubles.step,
      points: this.precomputed.doubles.points.slice(1)
    },
    naf: this.precomputed.naf && {
      wnd: this.precomputed.naf.wnd,
      points: this.precomputed.naf.points.slice(1)
    }
  }];
};

Point.fromJSON = function fromJSON(curve, obj, red) {
  if (typeof obj === 'string')
    obj = JSON.parse(obj);
  var res = curve.point(obj[0], obj[1], red);
  if (!obj[2])
    return res;

  function obj2point(obj) {
    return curve.point(obj[0], obj[1], red);
  }

  var pre = obj[2];
  res.precomputed = {
    beta: null,
    doubles: pre.doubles && {
      step: pre.doubles.step,
      points: [ res ].concat(pre.doubles.points.map(obj2point))
    },
    naf: pre.naf && {
      wnd: pre.naf.wnd,
      points: [ res ].concat(pre.naf.points.map(obj2point))
    }
  };
  return res;
};

Point.prototype.inspect = function inspect() {
  if (this.isInfinity())
    return '<EC Point Infinity>';
  return '<EC Point x: ' + this.x.fromRed().toString(16 ,2) +
      ' y: ' + this.y.fromRed().toString(16, 2) + '>';
};

Point.prototype.isInfinity = function isInfinity() {
  return this.inf;
};

Point.prototype.add = function add(p) {
  // O + P = P
  if (this.inf)
    return p;

  // P + O = P
  if (p.inf)
    return this;

  // P + P = 2P
  if (this.eq(p))
    return this.dbl();

  // P + (-P) = O
  if (this.neg().eq(p))
    return this.curve.point(null, null);

  // P + Q = O
  if (this.x.cmp(p.x) === 0)
    return this.curve.point(null, null);

  var c = this.y.redSub(p.y);
  if (c.cmpn(0) !== 0)
    c = c.redMul(this.x.redSub(p.x).redInvm());
  var nx = c.redSqr().redISub(this.x).redISub(p.x);
  var ny = c.redMul(this.x.redSub(nx)).redISub(this.y);
  return this.curve.point(nx, ny);
};

Point.prototype.dbl = function dbl() {
  if (this.inf)
    return this;

  // 2P = O
  var ys1 = this.y.redAdd(this.y);
  if (ys1.cmpn(0) === 0)
    return this.curve.point(null, null);

  var a = this.curve.a;

  var x2 = this.x.redSqr();
  var dyinv = ys1.redInvm();
  var c = x2.redAdd(x2).redIAdd(x2).redIAdd(a).redMul(dyinv);

  var nx = c.redSqr().redISub(this.x.redAdd(this.x));
  var ny = c.redMul(this.x.redSub(nx)).redISub(this.y);
  return this.curve.point(nx, ny);
};

Point.prototype.getX = function getX() {
  return this.x.fromRed();
};

Point.prototype.getY = function getY() {
  return this.y.fromRed();
};

Point.prototype.mul = function mul(k) {
  k = new bn(k, 16);

  if (this.precomputed && this.precomputed.doubles)
    return this.curve._fixedNafMul(this, k);
  else if (this.curve.endo)
    return this.curve._endoWnafMulAdd([ this ], [ k ]);
  else
    return this.curve._wnafMul(this, k);
};

Point.prototype.mulAdd = function mulAdd(k1, p2, k2) {
  var points = [ this, p2 ];
  var coeffs = [ k1, k2 ];
  if (this.curve.endo)
    return this.curve._endoWnafMulAdd(points, coeffs);
  else
    return this.curve._wnafMulAdd(1, points, coeffs, 2);
};

Point.prototype.eq = function eq(p) {
  return this === p ||
         this.inf === p.inf &&
             (this.inf || this.x.cmp(p.x) === 0 && this.y.cmp(p.y) === 0);
};

Point.prototype.neg = function neg(_precompute) {
  if (this.inf)
    return this;

  var res = this.curve.point(this.x, this.y.redNeg());
  if (_precompute && this.precomputed) {
    var pre = this.precomputed;
    function negate(p) {
      return p.neg();
    }
    res.precomputed = {
      naf: pre.naf && {
        wnd: pre.naf.wnd,
        points: pre.naf.points.map(negate)
      },
      doubles: pre.doubles && {
        step: pre.doubles.step,
        points: pre.doubles.points.map(negate)
      }
    };
  }
  return res;
};

Point.prototype.toJ = function toJ() {
  if (this.inf)
    return this.curve.jpoint(null, null, null);

  var res = this.curve.jpoint(this.x, this.y, this.curve.one);
  return res;
};

function JPoint(curve, x, y, z) {
  Base.BasePoint.call(this, curve, 'jacobian');
  if (x === null && y === null && z === null) {
    this.x = this.curve.one;
    this.y = this.curve.one;
    this.z = new bn(0);
  } else {
    this.x = new bn(x, 16);
    this.y = new bn(y, 16);
    this.z = new bn(z, 16);
  }
  if (!this.x.red)
    this.x = this.x.toRed(this.curve.red);
  if (!this.y.red)
    this.y = this.y.toRed(this.curve.red);
  if (!this.z.red)
    this.z = this.z.toRed(this.curve.red);

  this.zOne = this.z === this.curve.one;
}
inherits(JPoint, Base.BasePoint);

JPoint.prototype.toP = function toP() {
  if (this.isInfinity())
    return this.curve.point(null, null);

  var zinv = this.z.redInvm();
  var zinv2 = zinv.redSqr();
  var ax = this.x.redMul(zinv2);
  var ay = this.y.redMul(zinv2).redMul(zinv);

  return this.curve.point(ax, ay);
};

JPoint.prototype.neg = function neg() {
  return this.curve.jpoint(this.x, this.y.redNeg(), this.z);
};

JPoint.prototype.add = function add(p) {
  // O + P = P
  if (this.isInfinity())
    return p;

  // P + O = P
  if (p.isInfinity())
    return this;

  // 12M + 4S + 7A
  var pz2 = p.z.redSqr();
  var z2 = this.z.redSqr();
  var u1 = this.x.redMul(pz2);
  var u2 = p.x.redMul(z2);
  var s1 = this.y.redMul(pz2.redMul(p.z));
  var s2 = p.y.redMul(z2.redMul(this.z));

  var h = u1.redSub(u2);
  var r = s1.redSub(s2);
  if (h.cmpn(0) === 0) {
    if (r.cmpn(0) !== 0)
      return this.curve.jpoint(null, null, null);
    else
      return this.dbl();
  }

  var h2 = h.redSqr();
  var h3 = h2.redMul(h);
  var v = u1.redMul(h2);

  var nx = r.redSqr().redIAdd(h3).redISub(v).redISub(v);
  var ny = r.redMul(v.redISub(nx)).redISub(s1.redMul(h3));
  var nz = this.z.redMul(p.z).redMul(h);

  return this.curve.jpoint(nx, ny, nz);
};

JPoint.prototype.mixedAdd = function mixedAdd(p) {
  // O + P = P
  if (this.isInfinity())
    return p.toJ();

  // P + O = P
  if (p.isInfinity())
    return this;

  // 8M + 3S + 7A
  var z2 = this.z.redSqr();
  var u1 = this.x;
  var u2 = p.x.redMul(z2);
  var s1 = this.y;
  var s2 = p.y.redMul(z2).redMul(this.z);

  var h = u1.redSub(u2);
  var r = s1.redSub(s2);
  if (h.cmpn(0) === 0) {
    if (r.cmpn(0) !== 0)
      return this.curve.jpoint(null, null, null);
    else
      return this.dbl();
  }

  var h2 = h.redSqr();
  var h3 = h2.redMul(h);
  var v = u1.redMul(h2);

  var nx = r.redSqr().redIAdd(h3).redISub(v).redISub(v);
  var ny = r.redMul(v.redISub(nx)).redISub(s1.redMul(h3));
  var nz = this.z.redMul(h);

  return this.curve.jpoint(nx, ny, nz);
};

JPoint.prototype.dblp = function dblp(pow) {
  if (pow === 0)
    return this;
  if (this.isInfinity())
    return this;
  if (!pow)
    return this.dbl();

  if (this.curve.zeroA || this.curve.threeA) {
    var r = this;
    for (var i = 0; i < pow; i++)
      r = r.dbl();
    return r;
  }

  // 1M + 2S + 1A + N * (4S + 5M + 8A)
  // N = 1 => 6M + 6S + 9A
  var a = this.curve.a;
  var tinv = this.curve.tinv;

  var jx = this.x;
  var jy = this.y;
  var jz = this.z;
  var jz4 = jz.redSqr().redSqr();

  // Reuse results
  var jyd = jy.redAdd(jy);
  for (var i = 0; i < pow; i++) {
    var jx2 = jx.redSqr();
    var jyd2 = jyd.redSqr();
    var jyd4 = jyd2.redSqr();
    var c = jx2.redAdd(jx2).redIAdd(jx2).redIAdd(a.redMul(jz4));

    var t1 = jx.redMul(jyd2);
    var nx = c.redSqr().redISub(t1.redAdd(t1));
    var t2 = t1.redISub(nx);
    var dny = c.redMul(t2);
    dny = dny.redIAdd(dny).redISub(jyd4);
    var nz = jyd.redMul(jz);
    if (i + 1 < pow)
      jz4 = jz4.redMul(jyd4);

    jx = nx;
    jz = nz;
    jyd = dny;
  }

  return this.curve.jpoint(jx, jyd.redMul(tinv), jz);
};

JPoint.prototype.dbl = function dbl() {
  if (this.isInfinity())
    return this;

  if (this.curve.zeroA)
    return this._zeroDbl();
  else if (this.curve.threeA)
    return this._threeDbl();
  else
    return this._dbl();
};

JPoint.prototype._zeroDbl = function _zeroDbl() {
  // Z = 1
  if (this.zOne) {
    // http://hyperelliptic.org/EFD/g1p/auto-shortw-jacobian-0.html#doubling-mdbl-2007-bl
    // 1M + 5S + 14A

    // XX = X1^2
    var xx = this.x.redSqr();
    // YY = Y1^2
    var yy = this.y.redSqr();
    // YYYY = YY^2
    var yyyy = yy.redSqr();
    // S = 2 * ((X1 + YY)^2 - XX - YYYY)
    var s = this.x.redAdd(yy).redSqr().redISub(xx).redISub(yyyy);
    s = s.redIAdd(s);
    // M = 3 * XX + a; a = 0
    var m = xx.redAdd(xx).redIAdd(xx);
    // T = M ^ 2 - 2*S
    var t = m.redSqr().redISub(s).redISub(s);

    // 8 * YYYY
    var yyyy8 = yyyy.redIAdd(yyyy);
    yyyy8 = yyyy8.redIAdd(yyyy8);
    yyyy8 = yyyy8.redIAdd(yyyy8);

    // X3 = T
    var nx = t;
    // Y3 = M * (S - T) - 8 * YYYY
    var ny = m.redMul(s.redISub(t)).redISub(yyyy8);
    // Z3 = 2*Y1
    var nz = this.y.redAdd(this.y);
  } else {
    // http://hyperelliptic.org/EFD/g1p/auto-shortw-jacobian-0.html#doubling-dbl-2009-l
    // 2M + 5S + 13A

    // A = X1^2
    var a = this.x.redSqr();
    // B = Y1^2
    var b = this.y.redSqr();
    // C = B^2
    var c = b.redSqr();
    // D = 2 * ((X1 + B)^2 - A - C)
    var d = this.x.redAdd(b).redSqr().redISub(a).redISub(c);
    d = d.redIAdd(d);
    // E = 3 * A
    var e = a.redAdd(a).redIAdd(a);
    // F = E^2
    var f = e.redSqr();

    // 8 * C
    var c8 = c.redIAdd(c);
    c8 = c8.redIAdd(c8);
    c8 = c8.redIAdd(c8);

    // X3 = F - 2 * D
    var nx = f.redISub(d).redISub(d);
    // Y3 = E * (D - X3) - 8 * C
    var ny = e.redMul(d.redISub(nx)).redISub(c8);
    // Z3 = 2 * Y1 * Z1
    var nz = this.y.redMul(this.z);
    nz = nz.redIAdd(nz);
  }

  return this.curve.jpoint(nx, ny, nz);
};

JPoint.prototype._threeDbl = function _threeDbl() {
  // Z = 1
  if (this.zOne) {
    // http://hyperelliptic.org/EFD/g1p/auto-shortw-jacobian-3.html#doubling-mdbl-2007-bl
    // 1M + 5S + 15A

    // XX = X1^2
    var xx = this.x.redSqr();
    // YY = Y1^2
    var yy = this.y.redSqr();
    // YYYY = YY^2
    var yyyy = yy.redSqr();
    // S = 2 * ((X1 + YY)^2 - XX - YYYY)
    var s = this.x.redAdd(yy).redSqr().redISub(xx).redISub(yyyy);
    s = s.redIAdd(s);
    // M = 3 * XX + a
    var m = xx.redAdd(xx).redIAdd(xx).redIAdd(this.curve.a);
    // T = M^2 - 2 * S
    var t = m.redSqr().redISub(s).redISub(s);
    // X3 = T
    var nx = t;
    // Y3 = M * (S - T) - 8 * YYYY
    var yyyy8 = yyyy.redIAdd(yyyy);
    yyyy8 = yyyy8.redIAdd(yyyy8);
    yyyy8 = yyyy8.redIAdd(yyyy8);
    var ny = m.redMul(s.redISub(t)).redISub(yyyy8);
    // Z3 = 2 * Y1
    var nz = this.y.redAdd(this.y);
  } else {
    // http://hyperelliptic.org/EFD/g1p/auto-shortw-jacobian-3.html#doubling-dbl-2001-b
    // 3M + 5S

    // delta = Z1^2
    var delta = this.z.redSqr();
    // gamma = Y1^2
    var gamma = this.y.redSqr();
    // beta = X1 * gamma
    var beta = this.x.redMul(gamma);
    // alpha = 3 * (X1 - delta) * (X1 + delta)
    var alpha = this.x.redSub(delta).redMul(this.x.redAdd(delta));
    alpha = alpha.redAdd(alpha).redIAdd(alpha);
    // X3 = alpha^2 - 8 * beta
    var beta4 = beta.redIAdd(beta);
    beta4 = beta4.redIAdd(beta4);
    var beta8 = beta4.redAdd(beta4);
    var nx = alpha.redSqr().redISub(beta8);
    // Z3 = (Y1 + Z1)^2 - gamma - delta
    var nz = this.y.redAdd(this.z).redSqr().redISub(gamma).redISub(delta);
    // Y3 = alpha * (4 * beta - X3) - 8 * gamma^2
    var ggamma8 = gamma.redSqr();
    ggamma8 = ggamma8.redIAdd(ggamma8);
    ggamma8 = ggamma8.redIAdd(ggamma8);
    ggamma8 = ggamma8.redIAdd(ggamma8);
    var ny = alpha.redMul(beta4.redISub(nx)).redISub(ggamma8);
  }

  return this.curve.jpoint(nx, ny, nz);
};

JPoint.prototype._dbl = function _dbl() {
  var a = this.curve.a;
  var tinv = this.curve.tinv;

  // 4M + 6S + 10A
  var jx = this.x;
  var jy = this.y;
  var jz = this.z;
  var jz4 = jz.redSqr().redSqr();

  var jx2 = jx.redSqr();
  var jy2 = jy.redSqr();

  var c = jx2.redAdd(jx2).redIAdd(jx2).redIAdd(a.redMul(jz4));

  var jxd4 = jx.redAdd(jx);
  jxd4 = jxd4.redIAdd(jxd4);
  var t1 = jxd4.redMul(jy2);
  var nx = c.redSqr().redISub(t1.redAdd(t1));
  var t2 = t1.redISub(nx);

  var jyd8 = jy2.redSqr();
  jyd8 = jyd8.redIAdd(jyd8);
  jyd8 = jyd8.redIAdd(jyd8);
  jyd8 = jyd8.redIAdd(jyd8);
  var ny = c.redMul(t2).redISub(jyd8);
  var nz = jy.redAdd(jy).redMul(jz);

  return this.curve.jpoint(nx, ny, nz);
};

JPoint.prototype.trpl = function trpl() {
  if (!this.curve.zeroA)
    return this.dbl().add(this);

  // http://hyperelliptic.org/EFD/g1p/auto-shortw-jacobian-0.html#tripling-tpl-2007-bl
  // 5M + 10S + ...

  // XX = X1^2
  var xx = this.x.redSqr();
  // YY = Y1^2
  var yy = this.y.redSqr();
  // ZZ = Z1^2
  var zz = this.z.redSqr();
  // YYYY = YY^2
  var yyyy = yy.redSqr();
  // M = 3 * XX + a * ZZ2; a = 0
  var m = xx.redAdd(xx).redIAdd(xx);
  // MM = M^2
  var mm = m.redSqr();
  // E = 6 * ((X1 + YY)^2 - XX - YYYY) - MM
  var e = this.x.redAdd(yy).redSqr().redISub(xx).redISub(yyyy);
  e = e.redIAdd(e);
  e = e.redAdd(e).redIAdd(e);
  e = e.redISub(mm);
  // EE = E^2
  var ee = e.redSqr();
  // T = 16*YYYY
  var t = yyyy.redIAdd(yyyy);
  t = t.redIAdd(t);
  t = t.redIAdd(t);
  t = t.redIAdd(t);
  // U = (M + E)^2 - MM - EE - T
  var u = m.redIAdd(e).redSqr().redISub(mm).redISub(ee).redISub(t);
  // X3 = 4 * (X1 * EE - 4 * YY * U)
  var yyu4 = yy.redMul(u);
  yyu4 = yyu4.redIAdd(yyu4);
  yyu4 = yyu4.redIAdd(yyu4);
  var nx = this.x.redMul(ee).redISub(yyu4);
  nx = nx.redIAdd(nx);
  nx = nx.redIAdd(nx);
  // Y3 = 8 * Y1 * (U * (T - U) - E * EE)
  var ny = this.y.redMul(u.redMul(t.redISub(u)).redISub(e.redMul(ee)));
  ny = ny.redIAdd(ny);
  ny = ny.redIAdd(ny);
  ny = ny.redIAdd(ny);
  // Z3 = (Z1 + E)^2 - ZZ - EE
  var nz = this.z.redAdd(e).redSqr().redISub(zz).redISub(ee);

  return this.curve.jpoint(nx, ny, nz);
};

JPoint.prototype.mul = function mul(k, kbase) {
  k = new bn(k, kbase);

  return this.curve._wnafMul(this, k);
};

JPoint.prototype.eq = function eq(p) {
  if (p.type === 'affine')
    return this.eq(p.toJ());

  if (this === p)
    return true;

  // x1 * z2^2 == x2 * z1^2
  var z2 = this.z.redSqr();
  var pz2 = p.z.redSqr();
  if (this.x.redMul(pz2).redISub(p.x.redMul(z2)).cmpn(0) !== 0)
    return false;

  // y1 * z2^3 == y2 * z1^3
  var z3 = z2.redMul(this.z);
  var pz3 = pz2.redMul(p.z);
  return this.y.redMul(pz3).redISub(p.y.redMul(z3)).cmpn(0) === 0;
};

JPoint.prototype.inspect = function inspect() {
  if (this.isInfinity())
    return '<EC JPoint Infinity>';
  return '<EC JPoint x: ' + this.x.toString(16, 2) +
      ' y: ' + this.y.toString(16, 2) +
      ' z: ' + this.z.toString(16, 2) + '>';
};

JPoint.prototype.isInfinity = function isInfinity() {
  // XXX This code assumes that zero is always zero in red
  return this.z.cmpn(0) === 0;
};

},{"../../elliptic":29,"../curve":32,"bn.js":27,"inherits":143}],35:[function(require,module,exports){
var curves = exports;

var hash = require('hash.js');
var bn = require('bn.js');
var elliptic = require('../elliptic');

var assert = elliptic.utils.assert;

function PresetCurve(options) {
  if (options.type === 'short')
    this.curve = new elliptic.curve.short(options);
  else if (options.type === 'edwards')
    this.curve = new elliptic.curve.edwards(options);
  else
    this.curve = new elliptic.curve.mont(options);
  this.g = this.curve.g;
  this.n = this.curve.n;
  this.hash = options.hash;

  assert(this.g.validate(), 'Invalid curve');
  assert(this.g.mul(this.n).isInfinity(), 'Invalid curve, G*N != O');
}
curves.PresetCurve = PresetCurve;

function defineCurve(name, options) {
  Object.defineProperty(curves, name, {
    configurable: true,
    enumerable: true,
    get: function() {
      var curve = new PresetCurve(options);
      Object.defineProperty(curves, name, {
        configurable: true,
        enumerable: true,
        value: curve
      });
      return curve;
    }
  });
}

defineCurve('p192', {
  type: 'short',
  prime: 'p192',
  p: 'ffffffff ffffffff ffffffff fffffffe ffffffff ffffffff',
  a: 'ffffffff ffffffff ffffffff fffffffe ffffffff fffffffc',
  b: '64210519 e59c80e7 0fa7e9ab 72243049 feb8deec c146b9b1',
  n: 'ffffffff ffffffff ffffffff 99def836 146bc9b1 b4d22831',
  hash: hash.sha256,
  gRed: false,
  g: [
    '188da80e b03090f6 7cbf20eb 43a18800 f4ff0afd 82ff1012',
    '07192b95 ffc8da78 631011ed 6b24cdd5 73f977a1 1e794811'
  ],
});

defineCurve('p224', {
  type: 'short',
  prime: 'p224',
  p: 'ffffffff ffffffff ffffffff ffffffff 00000000 00000000 00000001',
  a: 'ffffffff ffffffff ffffffff fffffffe ffffffff ffffffff fffffffe',
  b: 'b4050a85 0c04b3ab f5413256 5044b0b7 d7bfd8ba 270b3943 2355ffb4',
  n: 'ffffffff ffffffff ffffffff ffff16a2 e0b8f03e 13dd2945 5c5c2a3d',
  hash: hash.sha256,
  gRed: false,
  g: [
    'b70e0cbd 6bb4bf7f 321390b9 4a03c1d3 56c21122 343280d6 115c1d21',
    'bd376388 b5f723fb 4c22dfe6 cd4375a0 5a074764 44d58199 85007e34'
  ],
});

defineCurve('p256', {
  type: 'short',
  prime: null,
  p: 'ffffffff 00000001 00000000 00000000 00000000 ffffffff ffffffff ffffffff',
  a: 'ffffffff 00000001 00000000 00000000 00000000 ffffffff ffffffff fffffffc',
  b: '5ac635d8 aa3a93e7 b3ebbd55 769886bc 651d06b0 cc53b0f6 3bce3c3e 27d2604b',
  n: 'ffffffff 00000000 ffffffff ffffffff bce6faad a7179e84 f3b9cac2 fc632551',
  hash: hash.sha256,
  gRed: false,
  g: [
    '6b17d1f2 e12c4247 f8bce6e5 63a440f2 77037d81 2deb33a0 f4a13945 d898c296',
    '4fe342e2 fe1a7f9b 8ee7eb4a 7c0f9e16 2bce3357 6b315ece cbb64068 37bf51f5'
  ],
});

defineCurve('curve25519', {
  type: 'mont',
  prime: 'p25519',
  p: '7fffffffffffffff ffffffffffffffff ffffffffffffffff ffffffffffffffed',
  a: '76d06',
  b: '0',
  n: '1000000000000000 0000000000000000 14def9dea2f79cd6 5812631a5cf5d3ed',
  hash: hash.sha256,
  gRed: false,
  g: [
    '9'
  ]
});

defineCurve('ed25519', {
  type: 'edwards',
  prime: 'p25519',
  p: '7fffffffffffffff ffffffffffffffff ffffffffffffffff ffffffffffffffed',
  a: '-1',
  c: '1',
  // -121665 * (121666^(-1)) (mod P)
  d: '52036cee2b6ffe73 8cc740797779e898 00700a4d4141d8ab 75eb4dca135978a3',
  n: '1000000000000000 0000000000000000 14def9dea2f79cd6 5812631a5cf5d3ed',
  hash: hash.sha256,
  gRed: false,
  g: [
    '216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a',

    // 4/5
    '6666666666666666666666666666666666666666666666666666666666666658'
  ]
});

defineCurve('secp256k1', {
  type: 'short',
  prime: 'k256',
  p: 'ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe fffffc2f',
  a: '0',
  b: '7',
  n: 'ffffffff ffffffff ffffffff fffffffe baaedce6 af48a03b bfd25e8c d0364141',
  h: '1',
  hash: hash.sha256,

  // Precomputed endomorphism
  beta: '7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee',
  lambda: '5363ad4cc05c30e0a5261c028812645a122e22ea20816678df02967c1b23bd72',
  basis: [
    {
      a: '3086d221a7d46bcde86c90e49284eb15',
      b: '-e4437ed6010e88286f547fa90abfe4c3'
    },
    {
      a: '114ca50f7a8e2f3f657c1108d9d44cfd8',
      b: '3086d221a7d46bcde86c90e49284eb15'
    }
  ],

  gRed: false,
  g: [
    '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8',
    {
      'doubles': {
        'step': 4,
        'points': [
          [
            'e60fce93b59e9ec53011aabc21c23e97b2a31369b87a5ae9c44ee89e2a6dec0a',
            'f7e3507399e595929db99f34f57937101296891e44d23f0be1f32cce69616821'
          ],
          [
            '8282263212c609d9ea2a6e3e172de238d8c39cabd5ac1ca10646e23fd5f51508',
            '11f8a8098557dfe45e8256e830b60ace62d613ac2f7b17bed31b6eaff6e26caf'
          ],
          [
            '175e159f728b865a72f99cc6c6fc846de0b93833fd2222ed73fce5b551e5b739',
            'd3506e0d9e3c79eba4ef97a51ff71f5eacb5955add24345c6efa6ffee9fed695'
          ],
          [
            '363d90d447b00c9c99ceac05b6262ee053441c7e55552ffe526bad8f83ff4640',
            '4e273adfc732221953b445397f3363145b9a89008199ecb62003c7f3bee9de9'
          ],
          [
            '8b4b5f165df3c2be8c6244b5b745638843e4a781a15bcd1b69f79a55dffdf80c',
            '4aad0a6f68d308b4b3fbd7813ab0da04f9e336546162ee56b3eff0c65fd4fd36'
          ],
          [
            '723cbaa6e5db996d6bf771c00bd548c7b700dbffa6c0e77bcb6115925232fcda',
            '96e867b5595cc498a921137488824d6e2660a0653779494801dc069d9eb39f5f'
          ],
          [
            'eebfa4d493bebf98ba5feec812c2d3b50947961237a919839a533eca0e7dd7fa',
            '5d9a8ca3970ef0f269ee7edaf178089d9ae4cdc3a711f712ddfd4fdae1de8999'
          ],
          [
            '100f44da696e71672791d0a09b7bde459f1215a29b3c03bfefd7835b39a48db0',
            'cdd9e13192a00b772ec8f3300c090666b7ff4a18ff5195ac0fbd5cd62bc65a09'
          ],
          [
            'e1031be262c7ed1b1dc9227a4a04c017a77f8d4464f3b3852c8acde6e534fd2d',
            '9d7061928940405e6bb6a4176597535af292dd419e1ced79a44f18f29456a00d'
          ],
          [
            'feea6cae46d55b530ac2839f143bd7ec5cf8b266a41d6af52d5e688d9094696d',
            'e57c6b6c97dce1bab06e4e12bf3ecd5c981c8957cc41442d3155debf18090088'
          ],
          [
            'da67a91d91049cdcb367be4be6ffca3cfeed657d808583de33fa978bc1ec6cb1',
            '9bacaa35481642bc41f463f7ec9780e5dec7adc508f740a17e9ea8e27a68be1d'
          ],
          [
            '53904faa0b334cdda6e000935ef22151ec08d0f7bb11069f57545ccc1a37b7c0',
            '5bc087d0bc80106d88c9eccac20d3c1c13999981e14434699dcb096b022771c8'
          ],
          [
            '8e7bcd0bd35983a7719cca7764ca906779b53a043a9b8bcaeff959f43ad86047',
            '10b7770b2a3da4b3940310420ca9514579e88e2e47fd68b3ea10047e8460372a'
          ],
          [
            '385eed34c1cdff21e6d0818689b81bde71a7f4f18397e6690a841e1599c43862',
            '283bebc3e8ea23f56701de19e9ebf4576b304eec2086dc8cc0458fe5542e5453'
          ],
          [
            '6f9d9b803ecf191637c73a4413dfa180fddf84a5947fbc9c606ed86c3fac3a7',
            '7c80c68e603059ba69b8e2a30e45c4d47ea4dd2f5c281002d86890603a842160'
          ],
          [
            '3322d401243c4e2582a2147c104d6ecbf774d163db0f5e5313b7e0e742d0e6bd',
            '56e70797e9664ef5bfb019bc4ddaf9b72805f63ea2873af624f3a2e96c28b2a0'
          ],
          [
            '85672c7d2de0b7da2bd1770d89665868741b3f9af7643397721d74d28134ab83',
            '7c481b9b5b43b2eb6374049bfa62c2e5e77f17fcc5298f44c8e3094f790313a6'
          ],
          [
            '948bf809b1988a46b06c9f1919413b10f9226c60f668832ffd959af60c82a0a',
            '53a562856dcb6646dc6b74c5d1c3418c6d4dff08c97cd2bed4cb7f88d8c8e589'
          ],
          [
            '6260ce7f461801c34f067ce0f02873a8f1b0e44dfc69752accecd819f38fd8e8',
            'bc2da82b6fa5b571a7f09049776a1ef7ecd292238051c198c1a84e95b2b4ae17'
          ],
          [
            'e5037de0afc1d8d43d8348414bbf4103043ec8f575bfdc432953cc8d2037fa2d',
            '4571534baa94d3b5f9f98d09fb990bddbd5f5b03ec481f10e0e5dc841d755bda'
          ],
          [
            'e06372b0f4a207adf5ea905e8f1771b4e7e8dbd1c6a6c5b725866a0ae4fce725',
            '7a908974bce18cfe12a27bb2ad5a488cd7484a7787104870b27034f94eee31dd'
          ],
          [
            '213c7a715cd5d45358d0bbf9dc0ce02204b10bdde2a3f58540ad6908d0559754',
            '4b6dad0b5ae462507013ad06245ba190bb4850f5f36a7eeddff2c27534b458f2'
          ],
          [
            '4e7c272a7af4b34e8dbb9352a5419a87e2838c70adc62cddf0cc3a3b08fbd53c',
            '17749c766c9d0b18e16fd09f6def681b530b9614bff7dd33e0b3941817dcaae6'
          ],
          [
            'fea74e3dbe778b1b10f238ad61686aa5c76e3db2be43057632427e2840fb27b6',
            '6e0568db9b0b13297cf674deccb6af93126b596b973f7b77701d3db7f23cb96f'
          ],
          [
            '76e64113f677cf0e10a2570d599968d31544e179b760432952c02a4417bdde39',
            'c90ddf8dee4e95cf577066d70681f0d35e2a33d2b56d2032b4b1752d1901ac01'
          ],
          [
            'c738c56b03b2abe1e8281baa743f8f9a8f7cc643df26cbee3ab150242bcbb891',
            '893fb578951ad2537f718f2eacbfbbbb82314eef7880cfe917e735d9699a84c3'
          ],
          [
            'd895626548b65b81e264c7637c972877d1d72e5f3a925014372e9f6588f6c14b',
            'febfaa38f2bc7eae728ec60818c340eb03428d632bb067e179363ed75d7d991f'
          ],
          [
            'b8da94032a957518eb0f6433571e8761ceffc73693e84edd49150a564f676e03',
            '2804dfa44805a1e4d7c99cc9762808b092cc584d95ff3b511488e4e74efdf6e7'
          ],
          [
            'e80fea14441fb33a7d8adab9475d7fab2019effb5156a792f1a11778e3c0df5d',
            'eed1de7f638e00771e89768ca3ca94472d155e80af322ea9fcb4291b6ac9ec78'
          ],
          [
            'a301697bdfcd704313ba48e51d567543f2a182031efd6915ddc07bbcc4e16070',
            '7370f91cfb67e4f5081809fa25d40f9b1735dbf7c0a11a130c0d1a041e177ea1'
          ],
          [
            '90ad85b389d6b936463f9d0512678de208cc330b11307fffab7ac63e3fb04ed4',
            'e507a3620a38261affdcbd9427222b839aefabe1582894d991d4d48cb6ef150'
          ],
          [
            '8f68b9d2f63b5f339239c1ad981f162ee88c5678723ea3351b7b444c9ec4c0da',
            '662a9f2dba063986de1d90c2b6be215dbbea2cfe95510bfdf23cbf79501fff82'
          ],
          [
            'e4f3fb0176af85d65ff99ff9198c36091f48e86503681e3e6686fd5053231e11',
            '1e63633ad0ef4f1c1661a6d0ea02b7286cc7e74ec951d1c9822c38576feb73bc'
          ],
          [
            '8c00fa9b18ebf331eb961537a45a4266c7034f2f0d4e1d0716fb6eae20eae29e',
            'efa47267fea521a1a9dc343a3736c974c2fadafa81e36c54e7d2a4c66702414b'
          ],
          [
            'e7a26ce69dd4829f3e10cec0a9e98ed3143d084f308b92c0997fddfc60cb3e41',
            '2a758e300fa7984b471b006a1aafbb18d0a6b2c0420e83e20e8a9421cf2cfd51'
          ],
          [
            'b6459e0ee3662ec8d23540c223bcbdc571cbcb967d79424f3cf29eb3de6b80ef',
            '67c876d06f3e06de1dadf16e5661db3c4b3ae6d48e35b2ff30bf0b61a71ba45'
          ],
          [
            'd68a80c8280bb840793234aa118f06231d6f1fc67e73c5a5deda0f5b496943e8',
            'db8ba9fff4b586d00c4b1f9177b0e28b5b0e7b8f7845295a294c84266b133120'
          ],
          [
            '324aed7df65c804252dc0270907a30b09612aeb973449cea4095980fc28d3d5d',
            '648a365774b61f2ff130c0c35aec1f4f19213b0c7e332843967224af96ab7c84'
          ],
          [
            '4df9c14919cde61f6d51dfdbe5fee5dceec4143ba8d1ca888e8bd373fd054c96',
            '35ec51092d8728050974c23a1d85d4b5d506cdc288490192ebac06cad10d5d'
          ],
          [
            '9c3919a84a474870faed8a9c1cc66021523489054d7f0308cbfc99c8ac1f98cd',
            'ddb84f0f4a4ddd57584f044bf260e641905326f76c64c8e6be7e5e03d4fc599d'
          ],
          [
            '6057170b1dd12fdf8de05f281d8e06bb91e1493a8b91d4cc5a21382120a959e5',
            '9a1af0b26a6a4807add9a2daf71df262465152bc3ee24c65e899be932385a2a8'
          ],
          [
            'a576df8e23a08411421439a4518da31880cef0fba7d4df12b1a6973eecb94266',
            '40a6bf20e76640b2c92b97afe58cd82c432e10a7f514d9f3ee8be11ae1b28ec8'
          ],
          [
            '7778a78c28dec3e30a05fe9629de8c38bb30d1f5cf9a3a208f763889be58ad71',
            '34626d9ab5a5b22ff7098e12f2ff580087b38411ff24ac563b513fc1fd9f43ac'
          ],
          [
            '928955ee637a84463729fd30e7afd2ed5f96274e5ad7e5cb09eda9c06d903ac',
            'c25621003d3f42a827b78a13093a95eeac3d26efa8a8d83fc5180e935bcd091f'
          ],
          [
            '85d0fef3ec6db109399064f3a0e3b2855645b4a907ad354527aae75163d82751',
            '1f03648413a38c0be29d496e582cf5663e8751e96877331582c237a24eb1f962'
          ],
          [
            'ff2b0dce97eece97c1c9b6041798b85dfdfb6d8882da20308f5404824526087e',
            '493d13fef524ba188af4c4dc54d07936c7b7ed6fb90e2ceb2c951e01f0c29907'
          ],
          [
            '827fbbe4b1e880ea9ed2b2e6301b212b57f1ee148cd6dd28780e5e2cf856e241',
            'c60f9c923c727b0b71bef2c67d1d12687ff7a63186903166d605b68baec293ec'
          ],
          [
            'eaa649f21f51bdbae7be4ae34ce6e5217a58fdce7f47f9aa7f3b58fa2120e2b3',
            'be3279ed5bbbb03ac69a80f89879aa5a01a6b965f13f7e59d47a5305ba5ad93d'
          ],
          [
            'e4a42d43c5cf169d9391df6decf42ee541b6d8f0c9a137401e23632dda34d24f',
            '4d9f92e716d1c73526fc99ccfb8ad34ce886eedfa8d8e4f13a7f7131deba9414'
          ],
          [
            '1ec80fef360cbdd954160fadab352b6b92b53576a88fea4947173b9d4300bf19',
            'aeefe93756b5340d2f3a4958a7abbf5e0146e77f6295a07b671cdc1cc107cefd'
          ],
          [
            '146a778c04670c2f91b00af4680dfa8bce3490717d58ba889ddb5928366642be',
            'b318e0ec3354028add669827f9d4b2870aaa971d2f7e5ed1d0b297483d83efd0'
          ],
          [
            'fa50c0f61d22e5f07e3acebb1aa07b128d0012209a28b9776d76a8793180eef9',
            '6b84c6922397eba9b72cd2872281a68a5e683293a57a213b38cd8d7d3f4f2811'
          ],
          [
            'da1d61d0ca721a11b1a5bf6b7d88e8421a288ab5d5bba5220e53d32b5f067ec2',
            '8157f55a7c99306c79c0766161c91e2966a73899d279b48a655fba0f1ad836f1'
          ],
          [
            'a8e282ff0c9706907215ff98e8fd416615311de0446f1e062a73b0610d064e13',
            '7f97355b8db81c09abfb7f3c5b2515888b679a3e50dd6bd6cef7c73111f4cc0c'
          ],
          [
            '174a53b9c9a285872d39e56e6913cab15d59b1fa512508c022f382de8319497c',
            'ccc9dc37abfc9c1657b4155f2c47f9e6646b3a1d8cb9854383da13ac079afa73'
          ],
          [
            '959396981943785c3d3e57edf5018cdbe039e730e4918b3d884fdff09475b7ba',
            '2e7e552888c331dd8ba0386a4b9cd6849c653f64c8709385e9b8abf87524f2fd'
          ],
          [
            'd2a63a50ae401e56d645a1153b109a8fcca0a43d561fba2dbb51340c9d82b151',
            'e82d86fb6443fcb7565aee58b2948220a70f750af484ca52d4142174dcf89405'
          ],
          [
            '64587e2335471eb890ee7896d7cfdc866bacbdbd3839317b3436f9b45617e073',
            'd99fcdd5bf6902e2ae96dd6447c299a185b90a39133aeab358299e5e9faf6589'
          ],
          [
            '8481bde0e4e4d885b3a546d3e549de042f0aa6cea250e7fd358d6c86dd45e458',
            '38ee7b8cba5404dd84a25bf39cecb2ca900a79c42b262e556d64b1b59779057e'
          ],
          [
            '13464a57a78102aa62b6979ae817f4637ffcfed3c4b1ce30bcd6303f6caf666b',
            '69be159004614580ef7e433453ccb0ca48f300a81d0942e13f495a907f6ecc27'
          ],
          [
            'bc4a9df5b713fe2e9aef430bcc1dc97a0cd9ccede2f28588cada3a0d2d83f366',
            'd3a81ca6e785c06383937adf4b798caa6e8a9fbfa547b16d758d666581f33c1'
          ],
          [
            '8c28a97bf8298bc0d23d8c749452a32e694b65e30a9472a3954ab30fe5324caa',
            '40a30463a3305193378fedf31f7cc0eb7ae784f0451cb9459e71dc73cbef9482'
          ],
          [
            '8ea9666139527a8c1dd94ce4f071fd23c8b350c5a4bb33748c4ba111faccae0',
            '620efabbc8ee2782e24e7c0cfb95c5d735b783be9cf0f8e955af34a30e62b945'
          ],
          [
            'dd3625faef5ba06074669716bbd3788d89bdde815959968092f76cc4eb9a9787',
            '7a188fa3520e30d461da2501045731ca941461982883395937f68d00c644a573'
          ],
          [
            'f710d79d9eb962297e4f6232b40e8f7feb2bc63814614d692c12de752408221e',
            'ea98e67232d3b3295d3b535532115ccac8612c721851617526ae47a9c77bfc82'
          ]
        ]
      },
      'naf': {
        'wnd': 7,
        'points': [
          [
            'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
            '388f7b0f632de8140fe337e62a37f3566500a99934c2231b6cb9fd7584b8e672'
          ],
          [
            '2f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
            'd8ac222636e5e3d6d4dba9dda6c9c426f788271bab0d6840dca87d3aa6ac62d6'
          ],
          [
            '5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc',
            '6aebca40ba255960a3178d6d861a54dba813d0b813fde7b5a5082628087264da'
          ],
          [
            'acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe',
            'cc338921b0a7d9fd64380971763b61e9add888a4375f8e0f05cc262ac64f9c37'
          ],
          [
            '774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb',
            'd984a032eb6b5e190243dd56d7b7b365372db1e2dff9d6a8301d74c9c953c61b'
          ],
          [
            'f28773c2d975288bc7d1d205c3748651b075fbc6610e58cddeeddf8f19405aa8',
            'ab0902e8d880a89758212eb65cdaf473a1a06da521fa91f29b5cb52db03ed81'
          ],
          [
            'd7924d4f7d43ea965a465ae3095ff41131e5946f3c85f79e44adbcf8e27e080e',
            '581e2872a86c72a683842ec228cc6defea40af2bd896d3a5c504dc9ff6a26b58'
          ],
          [
            'defdea4cdb677750a420fee807eacf21eb9898ae79b9768766e4faa04a2d4a34',
            '4211ab0694635168e997b0ead2a93daeced1f4a04a95c0f6cfb199f69e56eb77'
          ],
          [
            '2b4ea0a797a443d293ef5cff444f4979f06acfebd7e86d277475656138385b6c',
            '85e89bc037945d93b343083b5a1c86131a01f60c50269763b570c854e5c09b7a'
          ],
          [
            '352bbf4a4cdd12564f93fa332ce333301d9ad40271f8107181340aef25be59d5',
            '321eb4075348f534d59c18259dda3e1f4a1b3b2e71b1039c67bd3d8bcf81998c'
          ],
          [
            '2fa2104d6b38d11b0230010559879124e42ab8dfeff5ff29dc9cdadd4ecacc3f',
            '2de1068295dd865b64569335bd5dd80181d70ecfc882648423ba76b532b7d67'
          ],
          [
            '9248279b09b4d68dab21a9b066edda83263c3d84e09572e269ca0cd7f5453714',
            '73016f7bf234aade5d1aa71bdea2b1ff3fc0de2a887912ffe54a32ce97cb3402'
          ],
          [
            'daed4f2be3a8bf278e70132fb0beb7522f570e144bf615c07e996d443dee8729',
            'a69dce4a7d6c98e8d4a1aca87ef8d7003f83c230f3afa726ab40e52290be1c55'
          ],
          [
            'c44d12c7065d812e8acf28d7cbb19f9011ecd9e9fdf281b0e6a3b5e87d22e7db',
            '2119a460ce326cdc76c45926c982fdac0e106e861edf61c5a039063f0e0e6482'
          ],
          [
            '6a245bf6dc698504c89a20cfded60853152b695336c28063b61c65cbd269e6b4',
            'e022cf42c2bd4a708b3f5126f16a24ad8b33ba48d0423b6efd5e6348100d8a82'
          ],
          [
            '1697ffa6fd9de627c077e3d2fe541084ce13300b0bec1146f95ae57f0d0bd6a5',
            'b9c398f186806f5d27561506e4557433a2cf15009e498ae7adee9d63d01b2396'
          ],
          [
            '605bdb019981718b986d0f07e834cb0d9deb8360ffb7f61df982345ef27a7479',
            '2972d2de4f8d20681a78d93ec96fe23c26bfae84fb14db43b01e1e9056b8c49'
          ],
          [
            '62d14dab4150bf497402fdc45a215e10dcb01c354959b10cfe31c7e9d87ff33d',
            '80fc06bd8cc5b01098088a1950eed0db01aa132967ab472235f5642483b25eaf'
          ],
          [
            '80c60ad0040f27dade5b4b06c408e56b2c50e9f56b9b8b425e555c2f86308b6f',
            '1c38303f1cc5c30f26e66bad7fe72f70a65eed4cbe7024eb1aa01f56430bd57a'
          ],
          [
            '7a9375ad6167ad54aa74c6348cc54d344cc5dc9487d847049d5eabb0fa03c8fb',
            'd0e3fa9eca8726909559e0d79269046bdc59ea10c70ce2b02d499ec224dc7f7'
          ],
          [
            'd528ecd9b696b54c907a9ed045447a79bb408ec39b68df504bb51f459bc3ffc9',
            'eecf41253136e5f99966f21881fd656ebc4345405c520dbc063465b521409933'
          ],
          [
            '49370a4b5f43412ea25f514e8ecdad05266115e4a7ecb1387231808f8b45963',
            '758f3f41afd6ed428b3081b0512fd62a54c3f3afbb5b6764b653052a12949c9a'
          ],
          [
            '77f230936ee88cbbd73df930d64702ef881d811e0e1498e2f1c13eb1fc345d74',
            '958ef42a7886b6400a08266e9ba1b37896c95330d97077cbbe8eb3c7671c60d6'
          ],
          [
            'f2dac991cc4ce4b9ea44887e5c7c0bce58c80074ab9d4dbaeb28531b7739f530',
            'e0dedc9b3b2f8dad4da1f32dec2531df9eb5fbeb0598e4fd1a117dba703a3c37'
          ],
          [
            '463b3d9f662621fb1b4be8fbbe2520125a216cdfc9dae3debcba4850c690d45b',
            '5ed430d78c296c3543114306dd8622d7c622e27c970a1de31cb377b01af7307e'
          ],
          [
            'f16f804244e46e2a09232d4aff3b59976b98fac14328a2d1a32496b49998f247',
            'cedabd9b82203f7e13d206fcdf4e33d92a6c53c26e5cce26d6579962c4e31df6'
          ],
          [
            'caf754272dc84563b0352b7a14311af55d245315ace27c65369e15f7151d41d1',
            'cb474660ef35f5f2a41b643fa5e460575f4fa9b7962232a5c32f908318a04476'
          ],
          [
            '2600ca4b282cb986f85d0f1709979d8b44a09c07cb86d7c124497bc86f082120',
            '4119b88753c15bd6a693b03fcddbb45d5ac6be74ab5f0ef44b0be9475a7e4b40'
          ],
          [
            '7635ca72d7e8432c338ec53cd12220bc01c48685e24f7dc8c602a7746998e435',
            '91b649609489d613d1d5e590f78e6d74ecfc061d57048bad9e76f302c5b9c61'
          ],
          [
            '754e3239f325570cdbbf4a87deee8a66b7f2b33479d468fbc1a50743bf56cc18',
            '673fb86e5bda30fb3cd0ed304ea49a023ee33d0197a695d0c5d98093c536683'
          ],
          [
            'e3e6bd1071a1e96aff57859c82d570f0330800661d1c952f9fe2694691d9b9e8',
            '59c9e0bba394e76f40c0aa58379a3cb6a5a2283993e90c4167002af4920e37f5'
          ],
          [
            '186b483d056a033826ae73d88f732985c4ccb1f32ba35f4b4cc47fdcf04aa6eb',
            '3b952d32c67cf77e2e17446e204180ab21fb8090895138b4a4a797f86e80888b'
          ],
          [
            'df9d70a6b9876ce544c98561f4be4f725442e6d2b737d9c91a8321724ce0963f',
            '55eb2dafd84d6ccd5f862b785dc39d4ab157222720ef9da217b8c45cf2ba2417'
          ],
          [
            '5edd5cc23c51e87a497ca815d5dce0f8ab52554f849ed8995de64c5f34ce7143',
            'efae9c8dbc14130661e8cec030c89ad0c13c66c0d17a2905cdc706ab7399a868'
          ],
          [
            '290798c2b6476830da12fe02287e9e777aa3fba1c355b17a722d362f84614fba',
            'e38da76dcd440621988d00bcf79af25d5b29c094db2a23146d003afd41943e7a'
          ],
          [
            'af3c423a95d9f5b3054754efa150ac39cd29552fe360257362dfdecef4053b45',
            'f98a3fd831eb2b749a93b0e6f35cfb40c8cd5aa667a15581bc2feded498fd9c6'
          ],
          [
            '766dbb24d134e745cccaa28c99bf274906bb66b26dcf98df8d2fed50d884249a',
            '744b1152eacbe5e38dcc887980da38b897584a65fa06cedd2c924f97cbac5996'
          ],
          [
            '59dbf46f8c94759ba21277c33784f41645f7b44f6c596a58ce92e666191abe3e',
            'c534ad44175fbc300f4ea6ce648309a042ce739a7919798cd85e216c4a307f6e'
          ],
          [
            'f13ada95103c4537305e691e74e9a4a8dd647e711a95e73cb62dc6018cfd87b8',
            'e13817b44ee14de663bf4bc808341f326949e21a6a75c2570778419bdaf5733d'
          ],
          [
            '7754b4fa0e8aced06d4167a2c59cca4cda1869c06ebadfb6488550015a88522c',
            '30e93e864e669d82224b967c3020b8fa8d1e4e350b6cbcc537a48b57841163a2'
          ],
          [
            '948dcadf5990e048aa3874d46abef9d701858f95de8041d2a6828c99e2262519',
            'e491a42537f6e597d5d28a3224b1bc25df9154efbd2ef1d2cbba2cae5347d57e'
          ],
          [
            '7962414450c76c1689c7b48f8202ec37fb224cf5ac0bfa1570328a8a3d7c77ab',
            '100b610ec4ffb4760d5c1fc133ef6f6b12507a051f04ac5760afa5b29db83437'
          ],
          [
            '3514087834964b54b15b160644d915485a16977225b8847bb0dd085137ec47ca',
            'ef0afbb2056205448e1652c48e8127fc6039e77c15c2378b7e7d15a0de293311'
          ],
          [
            'd3cc30ad6b483e4bc79ce2c9dd8bc54993e947eb8df787b442943d3f7b527eaf',
            '8b378a22d827278d89c5e9be8f9508ae3c2ad46290358630afb34db04eede0a4'
          ],
          [
            '1624d84780732860ce1c78fcbfefe08b2b29823db913f6493975ba0ff4847610',
            '68651cf9b6da903e0914448c6cd9d4ca896878f5282be4c8cc06e2a404078575'
          ],
          [
            '733ce80da955a8a26902c95633e62a985192474b5af207da6df7b4fd5fc61cd4',
            'f5435a2bd2badf7d485a4d8b8db9fcce3e1ef8e0201e4578c54673bc1dc5ea1d'
          ],
          [
            '15d9441254945064cf1a1c33bbd3b49f8966c5092171e699ef258dfab81c045c',
            'd56eb30b69463e7234f5137b73b84177434800bacebfc685fc37bbe9efe4070d'
          ],
          [
            'a1d0fcf2ec9de675b612136e5ce70d271c21417c9d2b8aaaac138599d0717940',
            'edd77f50bcb5a3cab2e90737309667f2641462a54070f3d519212d39c197a629'
          ],
          [
            'e22fbe15c0af8ccc5780c0735f84dbe9a790badee8245c06c7ca37331cb36980',
            'a855babad5cd60c88b430a69f53a1a7a38289154964799be43d06d77d31da06'
          ],
          [
            '311091dd9860e8e20ee13473c1155f5f69635e394704eaa74009452246cfa9b3',
            '66db656f87d1f04fffd1f04788c06830871ec5a64feee685bd80f0b1286d8374'
          ],
          [
            '34c1fd04d301be89b31c0442d3e6ac24883928b45a9340781867d4232ec2dbdf',
            '9414685e97b1b5954bd46f730174136d57f1ceeb487443dc5321857ba73abee'
          ],
          [
            'f219ea5d6b54701c1c14de5b557eb42a8d13f3abbcd08affcc2a5e6b049b8d63',
            '4cb95957e83d40b0f73af4544cccf6b1f4b08d3c07b27fb8d8c2962a400766d1'
          ],
          [
            'd7b8740f74a8fbaab1f683db8f45de26543a5490bca627087236912469a0b448',
            'fa77968128d9c92ee1010f337ad4717eff15db5ed3c049b3411e0315eaa4593b'
          ],
          [
            '32d31c222f8f6f0ef86f7c98d3a3335ead5bcd32abdd94289fe4d3091aa824bf',
            '5f3032f5892156e39ccd3d7915b9e1da2e6dac9e6f26e961118d14b8462e1661'
          ],
          [
            '7461f371914ab32671045a155d9831ea8793d77cd59592c4340f86cbc18347b5',
            '8ec0ba238b96bec0cbdddcae0aa442542eee1ff50c986ea6b39847b3cc092ff6'
          ],
          [
            'ee079adb1df1860074356a25aa38206a6d716b2c3e67453d287698bad7b2b2d6',
            '8dc2412aafe3be5c4c5f37e0ecc5f9f6a446989af04c4e25ebaac479ec1c8c1e'
          ],
          [
            '16ec93e447ec83f0467b18302ee620f7e65de331874c9dc72bfd8616ba9da6b5',
            '5e4631150e62fb40d0e8c2a7ca5804a39d58186a50e497139626778e25b0674d'
          ],
          [
            'eaa5f980c245f6f038978290afa70b6bd8855897f98b6aa485b96065d537bd99',
            'f65f5d3e292c2e0819a528391c994624d784869d7e6ea67fb18041024edc07dc'
          ],
          [
            '78c9407544ac132692ee1910a02439958ae04877151342ea96c4b6b35a49f51',
            'f3e0319169eb9b85d5404795539a5e68fa1fbd583c064d2462b675f194a3ddb4'
          ],
          [
            '494f4be219a1a77016dcd838431aea0001cdc8ae7a6fc688726578d9702857a5',
            '42242a969283a5f339ba7f075e36ba2af925ce30d767ed6e55f4b031880d562c'
          ],
          [
            'a598a8030da6d86c6bc7f2f5144ea549d28211ea58faa70ebf4c1e665c1fe9b5',
            '204b5d6f84822c307e4b4a7140737aec23fc63b65b35f86a10026dbd2d864e6b'
          ],
          [
            'c41916365abb2b5d09192f5f2dbeafec208f020f12570a184dbadc3e58595997',
            '4f14351d0087efa49d245b328984989d5caf9450f34bfc0ed16e96b58fa9913'
          ],
          [
            '841d6063a586fa475a724604da03bc5b92a2e0d2e0a36acfe4c73a5514742881',
            '73867f59c0659e81904f9a1c7543698e62562d6744c169ce7a36de01a8d6154'
          ],
          [
            '5e95bb399a6971d376026947f89bde2f282b33810928be4ded112ac4d70e20d5',
            '39f23f366809085beebfc71181313775a99c9aed7d8ba38b161384c746012865'
          ],
          [
            '36e4641a53948fd476c39f8a99fd974e5ec07564b5315d8bf99471bca0ef2f66',
            'd2424b1b1abe4eb8164227b085c9aa9456ea13493fd563e06fd51cf5694c78fc'
          ],
          [
            '336581ea7bfbbb290c191a2f507a41cf5643842170e914faeab27c2c579f726',
            'ead12168595fe1be99252129b6e56b3391f7ab1410cd1e0ef3dcdcabd2fda224'
          ],
          [
            '8ab89816dadfd6b6a1f2634fcf00ec8403781025ed6890c4849742706bd43ede',
            '6fdcef09f2f6d0a044e654aef624136f503d459c3e89845858a47a9129cdd24e'
          ],
          [
            '1e33f1a746c9c5778133344d9299fcaa20b0938e8acff2544bb40284b8c5fb94',
            '60660257dd11b3aa9c8ed618d24edff2306d320f1d03010e33a7d2057f3b3b6'
          ],
          [
            '85b7c1dcb3cec1b7ee7f30ded79dd20a0ed1f4cc18cbcfcfa410361fd8f08f31',
            '3d98a9cdd026dd43f39048f25a8847f4fcafad1895d7a633c6fed3c35e999511'
          ],
          [
            '29df9fbd8d9e46509275f4b125d6d45d7fbe9a3b878a7af872a2800661ac5f51',
            'b4c4fe99c775a606e2d8862179139ffda61dc861c019e55cd2876eb2a27d84b'
          ],
          [
            'a0b1cae06b0a847a3fea6e671aaf8adfdfe58ca2f768105c8082b2e449fce252',
            'ae434102edde0958ec4b19d917a6a28e6b72da1834aff0e650f049503a296cf2'
          ],
          [
            '4e8ceafb9b3e9a136dc7ff67e840295b499dfb3b2133e4ba113f2e4c0e121e5',
            'cf2174118c8b6d7a4b48f6d534ce5c79422c086a63460502b827ce62a326683c'
          ],
          [
            'd24a44e047e19b6f5afb81c7ca2f69080a5076689a010919f42725c2b789a33b',
            '6fb8d5591b466f8fc63db50f1c0f1c69013f996887b8244d2cdec417afea8fa3'
          ],
          [
            'ea01606a7a6c9cdd249fdfcfacb99584001edd28abbab77b5104e98e8e3b35d4',
            '322af4908c7312b0cfbfe369f7a7b3cdb7d4494bc2823700cfd652188a3ea98d'
          ],
          [
            'af8addbf2b661c8a6c6328655eb96651252007d8c5ea31be4ad196de8ce2131f',
            '6749e67c029b85f52a034eafd096836b2520818680e26ac8f3dfbcdb71749700'
          ],
          [
            'e3ae1974566ca06cc516d47e0fb165a674a3dabcfca15e722f0e3450f45889',
            '2aeabe7e4531510116217f07bf4d07300de97e4874f81f533420a72eeb0bd6a4'
          ],
          [
            '591ee355313d99721cf6993ffed1e3e301993ff3ed258802075ea8ced397e246',
            'b0ea558a113c30bea60fc4775460c7901ff0b053d25ca2bdeee98f1a4be5d196'
          ],
          [
            '11396d55fda54c49f19aa97318d8da61fa8584e47b084945077cf03255b52984',
            '998c74a8cd45ac01289d5833a7beb4744ff536b01b257be4c5767bea93ea57a4'
          ],
          [
            '3c5d2a1ba39c5a1790000738c9e0c40b8dcdfd5468754b6405540157e017aa7a',
            'b2284279995a34e2f9d4de7396fc18b80f9b8b9fdd270f6661f79ca4c81bd257'
          ],
          [
            'cc8704b8a60a0defa3a99a7299f2e9c3fbc395afb04ac078425ef8a1793cc030',
            'bdd46039feed17881d1e0862db347f8cf395b74fc4bcdc4e940b74e3ac1f1b13'
          ],
          [
            'c533e4f7ea8555aacd9777ac5cad29b97dd4defccc53ee7ea204119b2889b197',
            '6f0a256bc5efdf429a2fb6242f1a43a2d9b925bb4a4b3a26bb8e0f45eb596096'
          ],
          [
            'c14f8f2ccb27d6f109f6d08d03cc96a69ba8c34eec07bbcf566d48e33da6593',
            'c359d6923bb398f7fd4473e16fe1c28475b740dd098075e6c0e8649113dc3a38'
          ],
          [
            'a6cbc3046bc6a450bac24789fa17115a4c9739ed75f8f21ce441f72e0b90e6ef',
            '21ae7f4680e889bb130619e2c0f95a360ceb573c70603139862afd617fa9b9f'
          ],
          [
            '347d6d9a02c48927ebfb86c1359b1caf130a3c0267d11ce6344b39f99d43cc38',
            '60ea7f61a353524d1c987f6ecec92f086d565ab687870cb12689ff1e31c74448'
          ],
          [
            'da6545d2181db8d983f7dcb375ef5866d47c67b1bf31c8cf855ef7437b72656a',
            '49b96715ab6878a79e78f07ce5680c5d6673051b4935bd897fea824b77dc208a'
          ],
          [
            'c40747cc9d012cb1a13b8148309c6de7ec25d6945d657146b9d5994b8feb1111',
            '5ca560753be2a12fc6de6caf2cb489565db936156b9514e1bb5e83037e0fa2d4'
          ],
          [
            '4e42c8ec82c99798ccf3a610be870e78338c7f713348bd34c8203ef4037f3502',
            '7571d74ee5e0fb92a7a8b33a07783341a5492144cc54bcc40a94473693606437'
          ],
          [
            '3775ab7089bc6af823aba2e1af70b236d251cadb0c86743287522a1b3b0dedea',
            'be52d107bcfa09d8bcb9736a828cfa7fac8db17bf7a76a2c42ad961409018cf7'
          ],
          [
            'cee31cbf7e34ec379d94fb814d3d775ad954595d1314ba8846959e3e82f74e26',
            '8fd64a14c06b589c26b947ae2bcf6bfa0149ef0be14ed4d80f448a01c43b1c6d'
          ],
          [
            'b4f9eaea09b6917619f6ea6a4eb5464efddb58fd45b1ebefcdc1a01d08b47986',
            '39e5c9925b5a54b07433a4f18c61726f8bb131c012ca542eb24a8ac07200682a'
          ],
          [
            'd4263dfc3d2df923a0179a48966d30ce84e2515afc3dccc1b77907792ebcc60e',
            '62dfaf07a0f78feb30e30d6295853ce189e127760ad6cf7fae164e122a208d54'
          ],
          [
            '48457524820fa65a4f8d35eb6930857c0032acc0a4a2de422233eeda897612c4',
            '25a748ab367979d98733c38a1fa1c2e7dc6cc07db2d60a9ae7a76aaa49bd0f77'
          ],
          [
            'dfeeef1881101f2cb11644f3a2afdfc2045e19919152923f367a1767c11cceda',
            'ecfb7056cf1de042f9420bab396793c0c390bde74b4bbdff16a83ae09a9a7517'
          ],
          [
            '6d7ef6b17543f8373c573f44e1f389835d89bcbc6062ced36c82df83b8fae859',
            'cd450ec335438986dfefa10c57fea9bcc521a0959b2d80bbf74b190dca712d10'
          ],
          [
            'e75605d59102a5a2684500d3b991f2e3f3c88b93225547035af25af66e04541f',
            'f5c54754a8f71ee540b9b48728473e314f729ac5308b06938360990e2bfad125'
          ],
          [
            'eb98660f4c4dfaa06a2be453d5020bc99a0c2e60abe388457dd43fefb1ed620c',
            '6cb9a8876d9cb8520609af3add26cd20a0a7cd8a9411131ce85f44100099223e'
          ],
          [
            '13e87b027d8514d35939f2e6892b19922154596941888336dc3563e3b8dba942',
            'fef5a3c68059a6dec5d624114bf1e91aac2b9da568d6abeb2570d55646b8adf1'
          ],
          [
            'ee163026e9fd6fe017c38f06a5be6fc125424b371ce2708e7bf4491691e5764a',
            '1acb250f255dd61c43d94ccc670d0f58f49ae3fa15b96623e5430da0ad6c62b2'
          ],
          [
            'b268f5ef9ad51e4d78de3a750c2dc89b1e626d43505867999932e5db33af3d80',
            '5f310d4b3c99b9ebb19f77d41c1dee018cf0d34fd4191614003e945a1216e423'
          ],
          [
            'ff07f3118a9df035e9fad85eb6c7bfe42b02f01ca99ceea3bf7ffdba93c4750d',
            '438136d603e858a3a5c440c38eccbaddc1d2942114e2eddd4740d098ced1f0d8'
          ],
          [
            '8d8b9855c7c052a34146fd20ffb658bea4b9f69e0d825ebec16e8c3ce2b526a1',
            'cdb559eedc2d79f926baf44fb84ea4d44bcf50fee51d7ceb30e2e7f463036758'
          ],
          [
            '52db0b5384dfbf05bfa9d472d7ae26dfe4b851ceca91b1eba54263180da32b63',
            'c3b997d050ee5d423ebaf66a6db9f57b3180c902875679de924b69d84a7b375'
          ],
          [
            'e62f9490d3d51da6395efd24e80919cc7d0f29c3f3fa48c6fff543becbd43352',
            '6d89ad7ba4876b0b22c2ca280c682862f342c8591f1daf5170e07bfd9ccafa7d'
          ],
          [
            '7f30ea2476b399b4957509c88f77d0191afa2ff5cb7b14fd6d8e7d65aaab1193',
            'ca5ef7d4b231c94c3b15389a5f6311e9daff7bb67b103e9880ef4bff637acaec'
          ],
          [
            '5098ff1e1d9f14fb46a210fada6c903fef0fb7b4a1dd1d9ac60a0361800b7a00',
            '9731141d81fc8f8084d37c6e7542006b3ee1b40d60dfe5362a5b132fd17ddc0'
          ],
          [
            '32b78c7de9ee512a72895be6b9cbefa6e2f3c4ccce445c96b9f2c81e2778ad58',
            'ee1849f513df71e32efc3896ee28260c73bb80547ae2275ba497237794c8753c'
          ],
          [
            'e2cb74fddc8e9fbcd076eef2a7c72b0ce37d50f08269dfc074b581550547a4f7',
            'd3aa2ed71c9dd2247a62df062736eb0baddea9e36122d2be8641abcb005cc4a4'
          ],
          [
            '8438447566d4d7bedadc299496ab357426009a35f235cb141be0d99cd10ae3a8',
            'c4e1020916980a4da5d01ac5e6ad330734ef0d7906631c4f2390426b2edd791f'
          ],
          [
            '4162d488b89402039b584c6fc6c308870587d9c46f660b878ab65c82c711d67e',
            '67163e903236289f776f22c25fb8a3afc1732f2b84b4e95dbda47ae5a0852649'
          ],
          [
            '3fad3fa84caf0f34f0f89bfd2dcf54fc175d767aec3e50684f3ba4a4bf5f683d',
            'cd1bc7cb6cc407bb2f0ca647c718a730cf71872e7d0d2a53fa20efcdfe61826'
          ],
          [
            '674f2600a3007a00568c1a7ce05d0816c1fb84bf1370798f1c69532faeb1a86b',
            '299d21f9413f33b3edf43b257004580b70db57da0b182259e09eecc69e0d38a5'
          ],
          [
            'd32f4da54ade74abb81b815ad1fb3b263d82d6c692714bcff87d29bd5ee9f08f',
            'f9429e738b8e53b968e99016c059707782e14f4535359d582fc416910b3eea87'
          ],
          [
            '30e4e670435385556e593657135845d36fbb6931f72b08cb1ed954f1e3ce3ff6',
            '462f9bce619898638499350113bbc9b10a878d35da70740dc695a559eb88db7b'
          ],
          [
            'be2062003c51cc3004682904330e4dee7f3dcd10b01e580bf1971b04d4cad297',
            '62188bc49d61e5428573d48a74e1c655b1c61090905682a0d5558ed72dccb9bc'
          ],
          [
            '93144423ace3451ed29e0fb9ac2af211cb6e84a601df5993c419859fff5df04a',
            '7c10dfb164c3425f5c71a3f9d7992038f1065224f72bb9d1d902a6d13037b47c'
          ],
          [
            'b015f8044f5fcbdcf21ca26d6c34fb8197829205c7b7d2a7cb66418c157b112c',
            'ab8c1e086d04e813744a655b2df8d5f83b3cdc6faa3088c1d3aea1454e3a1d5f'
          ],
          [
            'd5e9e1da649d97d89e4868117a465a3a4f8a18de57a140d36b3f2af341a21b52',
            '4cb04437f391ed73111a13cc1d4dd0db1693465c2240480d8955e8592f27447a'
          ],
          [
            'd3ae41047dd7ca065dbf8ed77b992439983005cd72e16d6f996a5316d36966bb',
            'bd1aeb21ad22ebb22a10f0303417c6d964f8cdd7df0aca614b10dc14d125ac46'
          ],
          [
            '463e2763d885f958fc66cdd22800f0a487197d0a82e377b49f80af87c897b065',
            'bfefacdb0e5d0fd7df3a311a94de062b26b80c61fbc97508b79992671ef7ca7f'
          ],
          [
            '7985fdfd127c0567c6f53ec1bb63ec3158e597c40bfe747c83cddfc910641917',
            '603c12daf3d9862ef2b25fe1de289aed24ed291e0ec6708703a5bd567f32ed03'
          ],
          [
            '74a1ad6b5f76e39db2dd249410eac7f99e74c59cb83d2d0ed5ff1543da7703e9',
            'cc6157ef18c9c63cd6193d83631bbea0093e0968942e8c33d5737fd790e0db08'
          ],
          [
            '30682a50703375f602d416664ba19b7fc9bab42c72747463a71d0896b22f6da3',
            '553e04f6b018b4fa6c8f39e7f311d3176290d0e0f19ca73f17714d9977a22ff8'
          ],
          [
            '9e2158f0d7c0d5f26c3791efefa79597654e7a2b2464f52b1ee6c1347769ef57',
            '712fcdd1b9053f09003a3481fa7762e9ffd7c8ef35a38509e2fbf2629008373'
          ],
          [
            '176e26989a43c9cfeba4029c202538c28172e566e3c4fce7322857f3be327d66',
            'ed8cc9d04b29eb877d270b4878dc43c19aefd31f4eee09ee7b47834c1fa4b1c3'
          ],
          [
            '75d46efea3771e6e68abb89a13ad747ecf1892393dfc4f1b7004788c50374da8',
            '9852390a99507679fd0b86fd2b39a868d7efc22151346e1a3ca4726586a6bed8'
          ],
          [
            '809a20c67d64900ffb698c4c825f6d5f2310fb0451c869345b7319f645605721',
            '9e994980d9917e22b76b061927fa04143d096ccc54963e6a5ebfa5f3f8e286c1'
          ],
          [
            '1b38903a43f7f114ed4500b4eac7083fdefece1cf29c63528d563446f972c180',
            '4036edc931a60ae889353f77fd53de4a2708b26b6f5da72ad3394119daf408f9'
          ]
        ]
      }
    }
  ]
});

},{"../elliptic":29,"bn.js":27,"hash.js":42}],36:[function(require,module,exports){
var bn = require('bn.js');
var elliptic = require('../../elliptic');
var utils = elliptic.utils;
var assert = utils.assert;

var KeyPair = require('./key');
var Signature = require('./signature');

function EC(options) {
  if (!(this instanceof EC))
    return new EC(options);

  // Shortcut `elliptic.ec(curve-name)`
  if (typeof options === 'string') {
    assert(elliptic.curves.hasOwnProperty(options), 'Unknown curve ' + options);

    options = elliptic.curves[options];
  }

  // Shortcut for `elliptic.ec(elliptic.curves.curveName)`
  if (options instanceof elliptic.curves.PresetCurve)
    options = { curve: options };

  this.curve = options.curve.curve;
  this.n = this.curve.n;
  this.nh = this.n.shrn(1);
  this.g = this.curve.g;

  // Point on curve
  this.g = options.curve.g;
  this.g.precompute(options.curve.n.bitLength() + 1);

  // Hash for function for DRBG
  this.hash = options.hash || options.curve.hash;
}
module.exports = EC;

EC.prototype.keyPair = function keyPair(priv, pub) {
  return new KeyPair(this, priv, pub);
};

EC.prototype.genKeyPair = function genKeyPair(options) {
  if (!options)
    options = {};

  // Instantiate Hmac_DRBG
  var drbg = new elliptic.hmacDRBG({
    hash: this.hash,
    pers: options.pers,
    entropy: options.entropy || elliptic.rand(this.hash.hmacStrength),
    nonce: this.n.toArray()
  });

  var bytes = this.n.byteLength();
  var ns2 = this.n.sub(new bn(2));
  do {
    var priv = new bn(drbg.generate(bytes));
    if (priv.cmp(ns2) > 0)
      continue;

    priv.iaddn(1);
    return this.keyPair(priv);
  } while (true);
};

EC.prototype._truncateToN = function truncateToN(msg, truncOnly) {
  var delta = msg.byteLength() * 8 - this.n.bitLength();
  if (delta > 0)
    msg = msg.shrn(delta);
  if (!truncOnly && msg.cmp(this.n) >= 0)
    return msg.sub(this.n);
  else
    return msg;
};

EC.prototype.sign = function sign(msg, key, options) {
  key = this.keyPair(key, 'hex');
  msg = this._truncateToN(new bn(msg, 16));
  if (!options)
    options = {};

  // Zero-extend key to provide enough entropy
  var bytes = this.n.byteLength();
  var bkey = key.getPrivate().toArray();
  for (var i = bkey.length; i < 21; i++)
    bkey.unshift(0);

  // Zero-extend nonce to have the same byte size as N
  var nonce = msg.toArray();
  for (var i = nonce.length; i < bytes; i++)
    nonce.unshift(0);

  // Instantiate Hmac_DRBG
  var drbg = new elliptic.hmacDRBG({
    hash: this.hash,
    entropy: bkey,
    nonce: nonce
  });

  // Number of bytes to generate
  var ns1 = this.n.sub(new bn(1));
  do {
    var k = new bn(drbg.generate(this.n.byteLength()));
    k = this._truncateToN(k, true);
    if (k.cmpn(1) <= 0 || k.cmp(ns1) >= 0)
      continue;

    var kp = this.g.mul(k);
    if (kp.isInfinity())
      continue;

    var r = kp.getX().mod(this.n);
    if (r.cmpn(0) === 0)
      continue;

    var s = k.invm(this.n).mul(r.mul(key.getPrivate()).iadd(msg)).mod(this.n);
    if (s.cmpn(0) === 0)
      continue;

    // Use complement of `s`, if it is > `n / 2`
    if (options.canonical && s.cmp(this.nh) > 0)
      s = this.n.sub(s);

    return new Signature(r, s);
  } while (true);
};

EC.prototype.verify = function verify(msg, signature, key) {
  msg = this._truncateToN(new bn(msg, 16));
  key = this.keyPair(key, 'hex');
  signature = new Signature(signature, 'hex');

  // Perform primitive values validation
  var r = signature.r;
  var s = signature.s;
  if (r.cmpn(1) < 0 || r.cmp(this.n) >= 0)
    return false;
  if (s.cmpn(1) < 0 || s.cmp(this.n) >= 0)
    return false;

  // Validate signature
  var sinv = s.invm(this.n);
  var u1 = sinv.mul(msg).mod(this.n);
  var u2 = sinv.mul(r).mod(this.n);

  var p = this.g.mulAdd(u1, key.getPublic(), u2);
  if (p.isInfinity())
    return false;

  return p.getX().mod(this.n).cmp(r) === 0;
};

},{"../../elliptic":29,"./key":37,"./signature":38,"bn.js":27}],37:[function(require,module,exports){
var bn = require('bn.js');

var elliptic = require('../../elliptic');
var utils = elliptic.utils;
var assert = utils.assert;

function KeyPair(ec, priv, pub) {
  if (priv instanceof KeyPair)
    return priv;
  if (pub instanceof KeyPair)
    return pub;

  if (!priv) {
    priv = pub;
    pub = null;
  }
  if (priv !== null && typeof priv === 'object') {
    if (priv.x) {
      // KeyPair(public)
      pub = priv;
      priv = null;
    } else if (priv.priv || priv.pub) {
      // KeyPair({ priv: ..., pub: ... })
      pub = priv.pub;
      priv = priv.priv;
    }
  }

  this.ec = ec;
  this.priv = null;
  this.pub = null;

  // KeyPair(public, 'hex')
  if (this._importPublicHex(priv, pub))
    return;

  if (pub === 'hex')
    pub = null;

  // KeyPair(priv, pub)
  if (priv)
    this._importPrivate(priv);
  if (pub)
    this._importPublic(pub);
}
module.exports = KeyPair;

KeyPair.prototype.validate = function validate() {
  var pub = this.getPublic();

  if (pub.isInfinity())
    return { result: false, reason: 'Invalid public key' };
  if (!pub.validate())
    return { result: false, reason: 'Public key is not a point' };
  if (!pub.mul(this.ec.curve.n).isInfinity())
    return { result: false, reason: 'Public key * N != O' };

  return { result: true, reason: null };
};

KeyPair.prototype.getPublic = function getPublic(compact, enc) {
  if (!this.pub)
    this.pub = this.ec.g.mul(this.priv);

  // compact is optional argument
  if (typeof compact === 'string') {
    enc = compact;
    compact = null;
  }

  if (!enc)
    return this.pub;

  var len = this.ec.curve.p.byteLength();
  var x = this.pub.getX().toArray();

  for (var i = x.length; i < len; i++)
    x.unshift(0);

  if (compact) {
    var res = [ this.pub.getY().isEven() ? 0x02 : 0x03 ].concat(x);
  } else {
    var y = this.pub.getY().toArray();
    for (var i = y.length; i < len; i++)
      y.unshift(0);
    var res = [ 0x04 ].concat(x, y);
  }
  return utils.encode(res, enc);
};

KeyPair.prototype.getPrivate = function getPrivate(enc) {
  if (enc === 'hex')
    return this.priv.toString(16, 2);
  else
    return this.priv;
};

KeyPair.prototype._importPrivate = function _importPrivate(key) {
  this.priv = new bn(key, 16);

  // Ensure that the priv won't be bigger than n, otherwise we may fail
  // in fixed multiplication method
  this.priv = this.priv.mod(this.ec.curve.n);
};

KeyPair.prototype._importPublic = function _importPublic(key) {
  this.pub = this.ec.curve.point(key.x, key.y);
};

KeyPair.prototype._importPublicHex = function _importPublic(key, enc) {
  key = utils.toArray(key, enc);
  var len = this.ec.curve.p.byteLength();
  if (key[0] === 0x04 && key.length - 1 === 2 * len) {
    this.pub = this.ec.curve.point(
      key.slice(1, 1 + len),
      key.slice(1 + len, 1 + 2 * len));
  } else if ((key[0] === 0x02 || key[0] === 0x03) && key.length - 1 === len) {
    this.pub = this.ec.curve.pointFromX(key[0] === 0x03,
                                        key.slice(1, 1 +len));
  } else {
    return false;
  }

  return true;
};

// ECDH
KeyPair.prototype.derive = function derive(pub) {
  return pub.mul(this.priv).getX();
};

// ECDSA
KeyPair.prototype.sign = function sign(msg) {
  return this.ec.sign(msg, this);
};

KeyPair.prototype.verify = function verify(msg, signature) {
  return this.ec.verify(msg, signature, this);
};

KeyPair.prototype.inspect = function inspect() {
  return '<Key priv: ' + (this.priv && this.priv.toString(16, 2)) +
         ' pub: ' + (this.pub && this.pub.inspect()) + ' >';
};

},{"../../elliptic":29,"bn.js":27}],38:[function(require,module,exports){
var bn = require('bn.js');

var elliptic = require('../../elliptic');
var utils = elliptic.utils;
var assert = utils.assert;

function Signature(r, s) {
  if (r instanceof Signature)
    return r;

  if (this._importDER(r, s))
    return;

  assert(r && s, 'Signature without r or s');
  this.r = new bn(r, 16);
  this.s = new bn(s, 16);
}
module.exports = Signature;

Signature.prototype._importDER = function _importDER(data, enc) {
  data = utils.toArray(data, enc);
  if (data.length < 6 || data[0] !== 0x30 || data[2] !== 0x02)
    return false;
  var total = data[1];
  if (1 + total > data.length)
    return false;
  var rlen = data[3];
  // Short length notation
  if (rlen >= 0x80)
    return false;
  if (4 + rlen + 2 >= data.length)
    return false;
  if (data[4 + rlen] !== 0x02)
    return false;
  var slen = data[5 + rlen];
  // Short length notation
  if (slen >= 0x80)
    return false;
  if (4 + rlen + 2 + slen > data.length)
    return false;

  this.r = new bn(data.slice(4, 4 + rlen));
  this.s = new bn(data.slice(4 + rlen + 2, 4 + rlen + 2 + slen));

  return true;
};

Signature.prototype.toDER = function toDER(enc) {
  var r = this.r.toArray();
  var s = this.s.toArray();

  // Pad values
  if (r[0] & 0x80)
    r = [ 0 ].concat(r);
  // Pad values
  if (s[0] & 0x80)
    s = [ 0 ].concat(s);

  var total = r.length + s.length + 4;
  var res = [ 0x30, total, 0x02, r.length ];
  res = res.concat(r, [ 0x02, s.length ], s);
  return utils.encode(res, enc);
};

},{"../../elliptic":29,"bn.js":27}],39:[function(require,module,exports){
var hash = require('hash.js');
var elliptic = require('../elliptic');
var utils = elliptic.utils;
var assert = utils.assert;

function HmacDRBG(options) {
  if (!(this instanceof HmacDRBG))
    return new HmacDRBG(options);
  this.hash = options.hash;
  this.predResist = !!options.predResist;

  this.outLen = this.hash.outSize;
  this.minEntropy = options.minEntropy || this.hash.hmacStrength;

  this.reseed = null;
  this.reseedInterval = null;
  this.K = null;
  this.V = null;

  var entropy = utils.toArray(options.entropy, options.entropyEnc);
  var nonce = utils.toArray(options.nonce, options.nonceEnc);
  var pers = utils.toArray(options.pers, options.persEnc);
  assert(entropy.length >= (this.minEntropy / 8),
         'Not enough entropy. Minimum is: ' + this.minEntropy + ' bits');
  this._init(entropy, nonce, pers);
}
module.exports = HmacDRBG;

HmacDRBG.prototype._init = function init(entropy, nonce, pers) {
  var seed = entropy.concat(nonce).concat(pers);

  this.K = new Array(this.outLen / 8);
  this.V = new Array(this.outLen / 8);
  for (var i = 0; i < this.V.length; i++) {
    this.K[i] = 0x00;
    this.V[i] = 0x01;
  }

  this._update(seed);
  this.reseed = 1;
  this.reseedInterval = 0x1000000000000;  // 2^48
};

HmacDRBG.prototype._hmac = function hmac() {
  return new hash.hmac(this.hash, this.K);
};

HmacDRBG.prototype._update = function update(seed) {
  var kmac = this._hmac()
                 .update(this.V)
                 .update([ 0x00 ]);
  if (seed)
    kmac = kmac.update(seed);
  this.K = kmac.digest();
  this.V = this._hmac().update(this.V).digest();
  if (!seed)
    return;

  this.K = this._hmac()
               .update(this.V)
               .update([ 0x01 ])
               .update(seed)
               .digest();
  this.V = this._hmac().update(this.V).digest();
};

HmacDRBG.prototype.reseed = function reseed(entropy, entropyEnc, add, addEnc) {
  // Optional entropy enc
  if (typeof entropyEnc !== 'string') {
    addEnc = add;
    add = entropyEnc;
    entropyEnc = null;
  }

  entropy = utils.toBuffer(entropy, entropyEnc);
  add = utils.toBuffer(add, addEnc);

  assert(entropy.length >= (this.minEntropy / 8),
         'Not enough entropy. Minimum is: ' + this.minEntropy + ' bits');

  this._update(entropy.concat(add || []));
  this.reseed = 1;
};

HmacDRBG.prototype.generate = function generate(len, enc, add, addEnc) {
  if (this.reseed > this.reseedInterval)
    throw new Error('Reseed is required');

  // Optional encoding
  if (typeof enc !== 'string') {
    addEnc = add;
    add = enc;
    enc = null;
  }

  // Optional additional data
  if (add) {
    add = utils.toArray(add, addEnc);
    this._update(add);
  }

  var temp = [];
  while (temp.length < len) {
    this.V = this._hmac().update(this.V).digest();
    temp = temp.concat(this.V);
  }

  var res = temp.slice(0, len);
  this._update(add);
  this.reseed++;
  return utils.encode(res, enc);
};

},{"../elliptic":29,"hash.js":42}],40:[function(require,module,exports){
var bn = require('bn.js');

var utils = exports;

utils.assert = function assert(val, msg) {
  if (!val)
    throw new Error(msg || 'Assertion failed');
};

function toArray(msg, enc) {
  if (Array.isArray(msg))
    return msg.slice();
  if (!msg)
    return [];
  var res = [];
  if (typeof msg === 'string') {
    if (!enc) {
      for (var i = 0; i < msg.length; i++) {
        var c = msg.charCodeAt(i);
        var hi = c >> 8;
        var lo = c & 0xff;
        if (hi)
          res.push(hi, lo);
        else
          res.push(lo);
      }
    } else if (enc === 'hex') {
      msg = msg.replace(/[^a-z0-9]+/ig, '');
      if (msg.length % 2 !== 0)
        msg = '0' + msg;
      for (var i = 0; i < msg.length; i += 2)
        res.push(parseInt(msg[i] + msg[i + 1], 16));
    }
  } else {
    for (var i = 0; i < msg.length; i++)
      res[i] = msg[i] | 0;
  }
  return res;
}
utils.toArray = toArray;

function toHex(msg) {
  var res = '';
  for (var i = 0; i < msg.length; i++)
    res += zero2(msg[i].toString(16));
  return res;
}
utils.toHex = toHex;

utils.encode = function encode(arr, enc) {
  if (enc === 'hex')
    return toHex(arr);
  else
    return arr;
};

function zero2(word) {
  if (word.length === 1)
    return '0' + word;
  else
    return word;
}
utils.zero2 = zero2;

// Represent num in a w-NAF form
function getNAF(num, w) {
  var naf = [];
  var ws = 1 << (w + 1);
  var k = num.clone();
  while (k.cmpn(1) >= 0) {
    var z;
    if (k.isOdd()) {
      var mod = k.andln(ws - 1);
      if (mod > (ws >> 1) - 1)
        z = (ws >> 1) - mod;
      else
        z = mod;
      k.isubn(z);
    } else {
      z = 0;
    }
    naf.push(z);

    // Optimization, shift by word if possible
    var shift = (k.cmpn(0) !== 0 && k.andln(ws - 1) === 0) ? (w + 1) : 1;
    for (var i = 1; i < shift; i++)
      naf.push(0);
    k.ishrn(shift);
  }

  return naf;
}
utils.getNAF = getNAF;

// Represent k1, k2 in a Joint Sparse Form
function getJSF(k1, k2) {
  var jsf = [
    [],
    []
  ];

  k1 = k1.clone();
  k2 = k2.clone();
  var d1 = 0;
  var d2 = 0;
  while (k1.cmpn(-d1) > 0 || k2.cmpn(-d2) > 0) {

    // First phase
    var m14 = (k1.andln(3) + d1) & 3;
    var m24 = (k2.andln(3) + d2) & 3;
    if (m14 === 3)
      m14 = -1;
    if (m24 === 3)
      m24 = -1;
    var u1;
    if ((m14 & 1) === 0) {
      u1 = 0;
    } else {
      var m8 = (k1.andln(7) + d1) & 7;
      if ((m8 === 3 || m8 === 5) && m24 === 2)
        u1 = -m14;
      else
        u1 = m14;
    }
    jsf[0].push(u1);

    var u2;
    if ((m24 & 1) === 0) {
      u2 = 0;
    } else {
      var m8 = (k2.andln(7) + d2) & 7;
      if ((m8 === 3 || m8 === 5) && m14 === 2)
        u2 = -m24;
      else
        u2 = m24;
    }
    jsf[1].push(u2);

    // Second phase
    if (2 * d1 === u1 + 1)
      d1 = 1 - d1;
    if (2 * d2 === u2 + 1)
      d2 = 1 - d2;
    k1.ishrn(1);
    k2.ishrn(1);
  }

  return jsf;
}
utils.getJSF = getJSF;

},{"bn.js":27}],41:[function(require,module,exports){
var r;

module.exports = function rand(len) {
  if (!r)
    r = new Rand(null);

  return r.generate(len);
};

function Rand(rand) {
  this.rand = rand;
}
module.exports.Rand = Rand;

Rand.prototype.generate = function generate(len) {
  return this._rand(len);
};

if (typeof window === 'object') {
  if (window.crypto && window.crypto.getRandomValues) {
    // Modern browsers
    Rand.prototype._rand = function _rand(n) {
      var arr = new Uint8Array(n);
      window.crypto.getRandomValues(arr);
      return arr;
    };
  } else if (window.msCrypto && window.msCrypto.getRandomValues) {
    // IE
    Rand.prototype._rand = function _rand(n) {
      var arr = new Uint8Array(n);
      window.msCrypto.getRandomValues(arr);
      return arr;
    };
  } else {
    // Old junk
    Rand.prototype._rand = function() {
      throw new Error('Not implemented yet');
    };
  }
} else {
  // Node.js or Web worker
  try {
    var crypto = require('cry' + 'pto');

    Rand.prototype._rand = function _rand(n) {
      return crypto.randomBytes(n);
    };
  } catch (e) {
    // Emulate crypto API using randy
    Rand.prototype._rand = function _rand(n) {
      var res = new Uint8Array(n);
      for (var i = 0; i < res.length; i++)
        res[i] = this.rand.getByte();
      return res;
    };
  }
}

},{}],42:[function(require,module,exports){
var hash = exports;

hash.utils = require('./hash/utils');
hash.common = require('./hash/common');
hash.sha = require('./hash/sha');
hash.ripemd = require('./hash/ripemd');
hash.hmac = require('./hash/hmac');

// Proxy hash functions to the main object
hash.sha1 = hash.sha.sha1;
hash.sha256 = hash.sha.sha256;
hash.sha224 = hash.sha.sha224;
hash.sha384 = hash.sha.sha384;
hash.sha512 = hash.sha.sha512;
hash.ripemd160 = hash.ripemd.ripemd160;

},{"./hash/common":43,"./hash/hmac":44,"./hash/ripemd":45,"./hash/sha":46,"./hash/utils":47}],43:[function(require,module,exports){
var hash = require('../hash');
var utils = hash.utils;
var assert = utils.assert;

function BlockHash() {
  this.pending = null;
  this.pendingTotal = 0;
  this.blockSize = this.constructor.blockSize;
  this.outSize = this.constructor.outSize;
  this.hmacStrength = this.constructor.hmacStrength;
  this.padLength = this.constructor.padLength / 8;
  this.endian = 'big';

  this._delta8 = this.blockSize / 8;
  this._delta32 = this.blockSize / 32;
}
exports.BlockHash = BlockHash;

BlockHash.prototype.update = function update(msg, enc) {
  // Convert message to array, pad it, and join into 32bit blocks
  msg = utils.toArray(msg, enc);
  if (!this.pending)
    this.pending = msg;
  else
    this.pending = this.pending.concat(msg);
  this.pendingTotal += msg.length;

  // Enough data, try updating
  if (this.pending.length >= this._delta8) {
    msg = this.pending;

    // Process pending data in blocks
    var r = msg.length % this._delta8;
    this.pending = msg.slice(msg.length - r, msg.length);
    if (this.pending.length === 0)
      this.pending = null;

    msg = utils.join32(msg, 0, msg.length - r, this.endian);
    for (var i = 0; i < msg.length; i += this._delta32)
      this._update(msg, i, i + this._delta32);
  }

  return this;
};

BlockHash.prototype.digest = function digest(enc) {
  this.update(this._pad());
  assert(this.pending === null);

  return this._digest(enc);
};

BlockHash.prototype._pad = function pad() {
  var len = this.pendingTotal;
  var bytes = this._delta8;
  var k = bytes - ((len + this.padLength) % bytes);
  var res = new Array(k + this.padLength);
  res[0] = 0x80;
  for (var i = 1; i < k; i++)
    res[i] = 0;

  // Append length
  len <<= 3;
  if (this.endian === 'big') {
    for (var t = 8; t < this.padLength; t++)
      res[i++] = 0;

    res[i++] = 0;
    res[i++] = 0;
    res[i++] = 0;
    res[i++] = 0;
    res[i++] = (len >>> 24) & 0xff;
    res[i++] = (len >>> 16) & 0xff;
    res[i++] = (len >>> 8) & 0xff;
    res[i++] = len & 0xff;
  } else {
    res[i++] = len & 0xff;
    res[i++] = (len >>> 8) & 0xff;
    res[i++] = (len >>> 16) & 0xff;
    res[i++] = (len >>> 24) & 0xff;
    res[i++] = 0;
    res[i++] = 0;
    res[i++] = 0;
    res[i++] = 0;

    for (var t = 8; t < this.padLength; t++)
      res[i++] = 0;
  }

  return res;
};

},{"../hash":42}],44:[function(require,module,exports){
var hmac = exports;

var hash = require('../hash');
var utils = hash.utils;
var assert = utils.assert;

function Hmac(hash, key, enc) {
  if (!(this instanceof Hmac))
    return new Hmac(hash, key, enc);
  this.Hash = hash;
  this.blockSize = hash.blockSize / 8;
  this.outSize = hash.outSize / 8;
  this.inner = null;
  this.outer = null;

  this._init(utils.toArray(key, enc));
}
module.exports = Hmac;

Hmac.prototype._init = function init(key) {
  // Shorten key, if needed
  if (key.length > this.blockSize)
    key = new this.Hash().update(key).digest();
  assert(key.length <= this.blockSize);

  // Add padding to key
  for (var i = key.length; i < this.blockSize; i++)
    key.push(0);

  for (var i = 0; i < key.length; i++)
    key[i] ^= 0x36;
  this.inner = new this.Hash().update(key);

  // 0x36 ^ 0x5c = 0x6a
  for (var i = 0; i < key.length; i++)
    key[i] ^= 0x6a;
  this.outer = new this.Hash().update(key);
};

Hmac.prototype.update = function update(msg, enc) {
  this.inner.update(msg, enc);
  return this;
};

Hmac.prototype.digest = function digest(enc) {
  this.outer.update(this.inner.digest());
  return this.outer.digest(enc);
};

},{"../hash":42}],45:[function(require,module,exports){
var hash = require('../hash');
var utils = hash.utils;

var rotl32 = utils.rotl32;
var sum32 = utils.sum32;
var sum32_3 = utils.sum32_3;
var sum32_4 = utils.sum32_4;
var BlockHash = hash.common.BlockHash;

function RIPEMD160() {
  if (!(this instanceof RIPEMD160))
    return new RIPEMD160();

  BlockHash.call(this);

  this.h = [ 0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0 ];
  this.endian = 'little';
}
utils.inherits(RIPEMD160, BlockHash);
exports.ripemd160 = RIPEMD160;

RIPEMD160.blockSize = 512;
RIPEMD160.outSize = 160;
RIPEMD160.hmacStrength = 192;
RIPEMD160.padLength = 64;

RIPEMD160.prototype._update = function update(msg, start) {
  var A = this.h[0];
  var B = this.h[1];
  var C = this.h[2];
  var D = this.h[3];
  var E = this.h[4];
  var Ah = A;
  var Bh = B;
  var Ch = C;
  var Dh = D;
  var Eh = E;
  for (var j = 0; j < 80; j++) {
    var T = sum32(
      rotl32(
        sum32_4(A, f(j, B, C, D), msg[r[j] + start], K(j)),
        s[j]),
      E);
    A = E;
    E = D;
    D = rotl32(C, 10);
    C = B;
    B = T;
    T = sum32(
      rotl32(
        sum32_4(Ah, f(79 - j, Bh, Ch, Dh), msg[rh[j] + start], Kh(j)),
        sh[j]),
      Eh);
    Ah = Eh;
    Eh = Dh;
    Dh = rotl32(Ch, 10);
    Ch = Bh;
    Bh = T;
  }
  T = sum32_3(this.h[1], C, Dh);
  this.h[1] = sum32_3(this.h[2], D, Eh);
  this.h[2] = sum32_3(this.h[3], E, Ah);
  this.h[3] = sum32_3(this.h[4], A, Bh);
  this.h[4] = sum32_3(this.h[0], B, Ch);
  this.h[0] = T;
};

RIPEMD160.prototype._digest = function digest(enc) {
  if (enc === 'hex')
    return utils.toHex32(this.h, 'little');
  else
    return utils.split32(this.h, 'little');
};

function f(j, x, y, z) {
  if (j <= 15)
    return x ^ y ^ z;
  else if (j <= 31)
    return (x & y) | ((~x) & z);
  else if (j <= 47)
    return (x | (~y)) ^ z;
  else if (j <= 63)
    return (x & z) | (y & (~z));
  else
    return x ^ (y | (~z));
}

function K(j) {
  if (j <= 15)
    return 0x00000000;
  else if (j <= 31)
    return 0x5a827999;
  else if (j <= 47)
    return 0x6ed9eba1;
  else if (j <= 63)
    return 0x8f1bbcdc;
  else
    return 0xa953fd4e;
}

function Kh(j) {
  if (j <= 15)
    return 0x50a28be6;
  else if (j <= 31)
    return 0x5c4dd124;
  else if (j <= 47)
    return 0x6d703ef3;
  else if (j <= 63)
    return 0x7a6d76e9;
  else
    return 0x00000000;
}

var r = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
];

var rh = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11
];

var s = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
];

var sh = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11
];

},{"../hash":42}],46:[function(require,module,exports){
var hash = require('../hash');
var utils = hash.utils;
var assert = utils.assert;

var rotr32 = utils.rotr32;
var rotl32 = utils.rotl32;
var sum32 = utils.sum32;
var sum32_4 = utils.sum32_4;
var sum32_5 = utils.sum32_5;
var rotr64_hi = utils.rotr64_hi;
var rotr64_lo = utils.rotr64_lo;
var shr64_hi = utils.shr64_hi;
var shr64_lo = utils.shr64_lo;
var sum64 = utils.sum64;
var sum64_hi = utils.sum64_hi;
var sum64_lo = utils.sum64_lo;
var sum64_4_hi = utils.sum64_4_hi;
var sum64_4_lo = utils.sum64_4_lo;
var sum64_5_hi = utils.sum64_5_hi;
var sum64_5_lo = utils.sum64_5_lo;
var BlockHash = hash.common.BlockHash;

var sha256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

var sha512_K = [
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd,
  0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
  0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019,
  0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe,
  0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
  0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1,
  0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3,
  0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483,
  0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210,
  0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
  0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725,
  0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926,
  0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
  0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8,
  0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001,
  0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
  0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910,
  0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53,
  0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
  0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb,
  0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60,
  0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9,
  0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207,
  0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
  0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6,
  0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493,
  0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
  0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a,
  0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817
];

var sha1_K = [
  0x5A827999, 0x6ED9EBA1,
  0x8F1BBCDC, 0xCA62C1D6
];

function SHA256() {
  if (!(this instanceof SHA256))
    return new SHA256();

  BlockHash.call(this);
  this.h = [ 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 ];
  this.k = sha256_K;
  this.W = new Array(64);
}
utils.inherits(SHA256, BlockHash);
exports.sha256 = SHA256;

SHA256.blockSize = 512;
SHA256.outSize = 256;
SHA256.hmacStrength = 192;
SHA256.padLength = 64;

SHA256.prototype._update = function _update(msg, start) {
  var W = this.W;

  for (var i = 0; i < 16; i++)
    W[i] = msg[start + i];
  for (; i < W.length; i++)
    W[i] = sum32_4(g1_256(W[i - 2]), W[i - 7], g0_256(W[i - 15]), W[i - 16]);

  var a = this.h[0];
  var b = this.h[1];
  var c = this.h[2];
  var d = this.h[3];
  var e = this.h[4];
  var f = this.h[5];
  var g = this.h[6];
  var h = this.h[7];

  assert(this.k.length === W.length);
  for (var i = 0; i < W.length; i++) {
    var T1 = sum32_5(h, s1_256(e), ch32(e, f, g), this.k[i], W[i]);
    var T2 = sum32(s0_256(a), maj32(a, b, c));
    h = g;
    g = f;
    f = e;
    e = sum32(d, T1);
    d = c;
    c = b;
    b = a;
    a = sum32(T1, T2);
  }

  this.h[0] = sum32(this.h[0], a);
  this.h[1] = sum32(this.h[1], b);
  this.h[2] = sum32(this.h[2], c);
  this.h[3] = sum32(this.h[3], d);
  this.h[4] = sum32(this.h[4], e);
  this.h[5] = sum32(this.h[5], f);
  this.h[6] = sum32(this.h[6], g);
  this.h[7] = sum32(this.h[7], h);
};

SHA256.prototype._digest = function digest(enc) {
  if (enc === 'hex')
    return utils.toHex32(this.h, 'big');
  else
    return utils.split32(this.h, 'big');
};

function SHA224() {
  if (!(this instanceof SHA224))
    return new SHA224();

  SHA256.call(this);
  this.h = [ 0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939,
             0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4 ];
}
utils.inherits(SHA224, SHA256);
exports.sha224 = SHA224;

SHA224.blockSize = 512;
SHA224.outSize = 224;
SHA224.hmacStrength = 192;
SHA224.padLength = 64;

SHA224.prototype._digest = function digest(enc) {
  // Just truncate output
  if (enc === 'hex')
    return utils.toHex32(this.h.slice(0, 7), 'big');
  else
    return utils.split32(this.h.slice(0, 7), 'big');
};

function SHA512() {
  if (!(this instanceof SHA512))
    return new SHA512();

  BlockHash.call(this);
  this.h = [ 0x6a09e667, 0xf3bcc908,
             0xbb67ae85, 0x84caa73b,
             0x3c6ef372, 0xfe94f82b,
             0xa54ff53a, 0x5f1d36f1,
             0x510e527f, 0xade682d1,
             0x9b05688c, 0x2b3e6c1f,
             0x1f83d9ab, 0xfb41bd6b,
             0x5be0cd19, 0x137e2179 ];
  this.k = sha512_K;
  this.W = new Array(160);
}
utils.inherits(SHA512, BlockHash);
exports.sha512 = SHA512;

SHA512.blockSize = 1024;
SHA512.outSize = 512;
SHA512.hmacStrength = 192;
SHA512.padLength = 128;

SHA512.prototype._prepareBlock = function _prepareBlock(msg, start) {
  var W = this.W;

  // 32 x 32bit words
  for (var i = 0; i < 32; i++)
    W[i] = msg[start + i];
  for (; i < W.length; i += 2) {
    var c0_hi = g1_512_hi(W[i - 4], W[i - 3]);  // i - 2
    var c0_lo = g1_512_lo(W[i - 4], W[i - 3]);
    var c1_hi = W[i - 14];  // i - 7
    var c1_lo = W[i - 13];
    var c2_hi = g0_512_hi(W[i - 30], W[i - 29]);  // i - 15
    var c2_lo = g0_512_lo(W[i - 30], W[i - 29]);
    var c3_hi = W[i - 32];  // i - 16
    var c3_lo = W[i - 31];

    W[i] = sum64_4_hi(c0_hi, c0_lo,
                      c1_hi, c1_lo,
                      c2_hi, c2_lo,
                      c3_hi, c3_lo);
    W[i + 1] = sum64_4_lo(c0_hi, c0_lo,
                          c1_hi, c1_lo,
                          c2_hi, c2_lo,
                          c3_hi, c3_lo);
  }
};

SHA512.prototype._update = function _update(msg, start) {
  this._prepareBlock(msg, start);

  var W = this.W;

  var ah = this.h[0];
  var al = this.h[1];
  var bh = this.h[2];
  var bl = this.h[3];
  var ch = this.h[4];
  var cl = this.h[5];
  var dh = this.h[6];
  var dl = this.h[7];
  var eh = this.h[8];
  var el = this.h[9];
  var fh = this.h[10];
  var fl = this.h[11];
  var gh = this.h[12];
  var gl = this.h[13];
  var hh = this.h[14];
  var hl = this.h[15];

  assert(this.k.length === W.length);
  for (var i = 0; i < W.length; i += 2) {
    var c0_hi = hh;
    var c0_lo = hl;
    var c1_hi = s1_512_hi(eh, el);
    var c1_lo = s1_512_lo(eh, el);
    var c2_hi = ch64_hi(eh, el, fh, fl, gh, gl);
    var c2_lo = ch64_lo(eh, el, fh, fl, gh, gl);
    var c3_hi = this.k[i];
    var c3_lo = this.k[i + 1];
    var c4_hi = W[i];
    var c4_lo = W[i + 1];

    var T1_hi = sum64_5_hi(c0_hi, c0_lo,
                           c1_hi, c1_lo,
                           c2_hi, c2_lo,
                           c3_hi, c3_lo,
                           c4_hi, c4_lo);
    var T1_lo = sum64_5_lo(c0_hi, c0_lo,
                           c1_hi, c1_lo,
                           c2_hi, c2_lo,
                           c3_hi, c3_lo,
                           c4_hi, c4_lo);

    var c0_hi = s0_512_hi(ah, al);
    var c0_lo = s0_512_lo(ah, al);
    var c1_hi = maj64_hi(ah, al, bh, bl, ch, cl);
    var c1_lo = maj64_lo(ah, al, bh, bl, ch, cl);

    var T2_hi = sum64_hi(c0_hi, c0_lo, c1_hi, c1_lo);
    var T2_lo = sum64_lo(c0_hi, c0_lo, c1_hi, c1_lo);

    hh = gh;
    hl = gl;

    gh = fh;
    gl = fl;

    fh = eh;
    fl = el;

    eh = sum64_hi(dh, dl, T1_hi, T1_lo);
    el = sum64_lo(dl, dl, T1_hi, T1_lo);

    dh = ch;
    dl = cl;

    ch = bh;
    cl = bl;

    bh = ah;
    bl = al;

    ah = sum64_hi(T1_hi, T1_lo, T2_hi, T2_lo);
    al = sum64_lo(T1_hi, T1_lo, T2_hi, T2_lo);
  }

  sum64(this.h, 0, ah, al);
  sum64(this.h, 2, bh, bl);
  sum64(this.h, 4, ch, cl);
  sum64(this.h, 6, dh, dl);
  sum64(this.h, 8, eh, el);
  sum64(this.h, 10, fh, fl);
  sum64(this.h, 12, gh, gl);
  sum64(this.h, 14, hh, hl);
};

SHA512.prototype._digest = function digest(enc) {
  if (enc === 'hex')
    return utils.toHex32(this.h, 'big');
  else
    return utils.split32(this.h, 'big');
};

function SHA384() {
  if (!(this instanceof SHA384))
    return new SHA384();

  SHA512.call(this);
  this.h = [ 0xcbbb9d5d, 0xc1059ed8,
             0x629a292a, 0x367cd507,
             0x9159015a, 0x3070dd17,
             0x152fecd8, 0xf70e5939,
             0x67332667, 0xffc00b31,
             0x8eb44a87, 0x68581511,
             0xdb0c2e0d, 0x64f98fa7,
             0x47b5481d, 0xbefa4fa4 ];
}
utils.inherits(SHA384, SHA512);
exports.sha384 = SHA384;

SHA384.blockSize = 1024;
SHA384.outSize = 384;
SHA384.hmacStrength = 192;
SHA384.padLength = 128;

SHA384.prototype._digest = function digest(enc) {
  if (enc === 'hex')
    return utils.toHex32(this.h.slice(0, 12), 'big');
  else
    return utils.split32(this.h.slice(0, 12), 'big');
};

function SHA1() {
  if (!(this instanceof SHA1))
    return new SHA1();

  BlockHash.call(this);
  this.h = [ 0x67452301, 0xefcdab89, 0x98badcfe,
             0x10325476, 0xc3d2e1f0 ];
  this.W = new Array(80);
}

utils.inherits(SHA1, BlockHash);
exports.sha1 = SHA1;

SHA1.blockSize = 512;
SHA1.outSize = 160;
SHA1.hmacStrength = 80;
SHA1.padLength = 64;

SHA1.prototype._update = function _update(msg, start) {
  var W = this.W;

  for (var i = 0; i < 16; i++)
    W[i] = msg[start + i];

  for(; i < W.length; i++)
    W[i] = rotl32(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);

  var a = this.h[0];
  var b = this.h[1];
  var c = this.h[2];
  var d = this.h[3];
  var e = this.h[4];

  for (var i = 0; i < W.length; i++) {
    var s = ~~(i / 20);
    var t = sum32_5(rotl32(a, 5), ft_1(s, b, c, d), e, W[i], sha1_K[s]);
    e = d;
    d = c;
    c = rotl32(b, 30);
    b = a;
    a = t;
  }

  this.h[0] = sum32(this.h[0], a);
  this.h[1] = sum32(this.h[1], b);
  this.h[2] = sum32(this.h[2], c);
  this.h[3] = sum32(this.h[3], d);
  this.h[4] = sum32(this.h[4], e);
};

SHA1.prototype._digest = function digest(enc) {
  if (enc === 'hex')
    return utils.toHex32(this.h, 'big');
  else
    return utils.split32(this.h, 'big');
};

function ch32(x, y, z) {
  return (x & y) ^ ((~x) & z);
}

function maj32(x, y, z) {
  return (x & y) ^ (x & z) ^ (y & z);
}

function p32(x, y, z) {
  return x ^ y ^ z;
}

function s0_256(x) {
  return rotr32(x, 2) ^ rotr32(x, 13) ^ rotr32(x, 22);
}

function s1_256(x) {
  return rotr32(x, 6) ^ rotr32(x, 11) ^ rotr32(x, 25);
}

function g0_256(x) {
  return rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3);
}

function g1_256(x) {
  return rotr32(x, 17) ^ rotr32(x, 19) ^ (x >>> 10);
}

function ft_1(s, x, y, z) {
  if (s === 0)
    return ch32(x, y, z);
  if (s === 1 || s === 3)
    return p32(x, y, z);
  if (s === 2)
    return maj32(x, y, z);
}

function ch64_hi(xh, xl, yh, yl, zh, zl) {
  var r = (xh & yh) ^ ((~xh) & zh);
  if (r < 0)
    r += 0x100000000;
  return r;
}

function ch64_lo(xh, xl, yh, yl, zh, zl) {
  var r = (xl & yl) ^ ((~xl) & zl);
  if (r < 0)
    r += 0x100000000;
  return r;
}

function maj64_hi(xh, xl, yh, yl, zh, zl) {
  var r = (xh & yh) ^ (xh & zh) ^ (yh & zh);
  if (r < 0)
    r += 0x100000000;
  return r;
}

function maj64_lo(xh, xl, yh, yl, zh, zl) {
  var r = (xl & yl) ^ (xl & zl) ^ (yl & zl);
  if (r < 0)
    r += 0x100000000;
  return r;
}

function s0_512_hi(xh, xl) {
  var c0_hi = rotr64_hi(xh, xl, 28);
  var c1_hi = rotr64_hi(xl, xh, 2);  // 34
  var c2_hi = rotr64_hi(xl, xh, 7);  // 39

  var r = c0_hi ^ c1_hi ^ c2_hi;
  if (r < 0)
    r += 0x100000000;
  return r;
}

function s0_512_lo(xh, xl) {
  var c0_lo = rotr64_lo(xh, xl, 28);
  var c1_lo = rotr64_lo(xl, xh, 2);  // 34
  var c2_lo = rotr64_lo(xl, xh, 7);  // 39

  var r = c0_lo ^ c1_lo ^ c2_lo;
  if (r < 0)
    r += 0x100000000;
  return r;
}

function s1_512_hi(xh, xl) {
  var c0_hi = rotr64_hi(xh, xl, 14);
  var c1_hi = rotr64_hi(xh, xl, 18);
  var c2_hi = rotr64_hi(xl, xh, 9);  // 41

  var r = c0_hi ^ c1_hi ^ c2_hi;
  if (r < 0)
    r += 0x100000000;
  return r;
}

function s1_512_lo(xh, xl) {
  var c0_lo = rotr64_lo(xh, xl, 14);
  var c1_lo = rotr64_lo(xh, xl, 18);
  var c2_lo = rotr64_lo(xl, xh, 9);  // 41

  var r = c0_lo ^ c1_lo ^ c2_lo;
  if (r < 0)
    r += 0x100000000;
  return r;
}

function g0_512_hi(xh, xl) {
  var c0_hi = rotr64_hi(xh, xl, 1);
  var c1_hi = rotr64_hi(xh, xl, 8);
  var c2_hi = shr64_hi(xh, xl, 7);

  var r = c0_hi ^ c1_hi ^ c2_hi;
  if (r < 0)
    r += 0x100000000;
  return r;
}

function g0_512_lo(xh, xl) {
  var c0_lo = rotr64_lo(xh, xl, 1);
  var c1_lo = rotr64_lo(xh, xl, 8);
  var c2_lo = shr64_lo(xh, xl, 7);

  var r = c0_lo ^ c1_lo ^ c2_lo;
  if (r < 0)
    r += 0x100000000;
  return r;
}

function g1_512_hi(xh, xl) {
  var c0_hi = rotr64_hi(xh, xl, 19);
  var c1_hi = rotr64_hi(xl, xh, 29);  // 61
  var c2_hi = shr64_hi(xh, xl, 6);

  var r = c0_hi ^ c1_hi ^ c2_hi;
  if (r < 0)
    r += 0x100000000;
  return r;
}

function g1_512_lo(xh, xl) {
  var c0_lo = rotr64_lo(xh, xl, 19);
  var c1_lo = rotr64_lo(xl, xh, 29);  // 61
  var c2_lo = shr64_lo(xh, xl, 6);

  var r = c0_lo ^ c1_lo ^ c2_lo;
  if (r < 0)
    r += 0x100000000;
  return r;
}

},{"../hash":42}],47:[function(require,module,exports){
var utils = exports;
var inherits = require('inherits');

function toArray(msg, enc) {
  if (Array.isArray(msg))
    return msg.slice();
  if (!msg)
    return [];
  var res = [];
  if (typeof msg === 'string') {
    if (!enc) {
      for (var i = 0; i < msg.length; i++) {
        var c = msg.charCodeAt(i);
        var hi = c >> 8;
        var lo = c & 0xff;
        if (hi)
          res.push(hi, lo);
        else
          res.push(lo);
      }
    } else if (enc === 'hex') {
      msg = msg.replace(/[^a-z0-9]+/ig, '');
      if (msg.length % 2 !== 0)
        msg = '0' + msg;
      for (var i = 0; i < msg.length; i += 2)
        res.push(parseInt(msg[i] + msg[i + 1], 16));
    }
  } else {
    for (var i = 0; i < msg.length; i++)
      res[i] = msg[i] | 0;
  }
  return res;
}
utils.toArray = toArray;

function toHex(msg) {
  var res = '';
  for (var i = 0; i < msg.length; i++)
    res += zero2(msg[i].toString(16));
  return res;
}
utils.toHex = toHex;

function htonl(w) {
  var res = (w >>> 24) |
            ((w >>> 8) & 0xff00) |
            ((w << 8) & 0xff0000) |
            ((w & 0xff) << 24);
  return res >>> 0;
}
utils.htonl = htonl;

function toHex32(msg, endian) {
  var res = '';
  for (var i = 0; i < msg.length; i++) {
    var w = msg[i];
    if (endian === 'little')
      w = htonl(w);
    res += zero8(w.toString(16));
  }
  return res;
}
utils.toHex32 = toHex32;

function zero2(word) {
  if (word.length === 1)
    return '0' + word;
  else
    return word;
}
utils.zero2 = zero2;

function zero8(word) {
  if (word.length === 7)
    return '0' + word;
  else if (word.length === 6)
    return '00' + word;
  else if (word.length === 5)
    return '000' + word;
  else if (word.length === 4)
    return '0000' + word;
  else if (word.length === 3)
    return '00000' + word;
  else if (word.length === 2)
    return '000000' + word;
  else if (word.length === 1)
    return '0000000' + word;
  else
    return word;
}
utils.zero8 = zero8;

function join32(msg, start, end, endian) {
  var len = end - start;
  assert(len % 4 === 0);
  var res = new Array(len / 4);
  for (var i = 0, k = start; i < res.length; i++, k += 4) {
    var w;
    if (endian === 'big')
      w = (msg[k] << 24) | (msg[k + 1] << 16) | (msg[k + 2] << 8) | msg[k + 3];
    else
      w = (msg[k + 3] << 24) | (msg[k + 2] << 16) | (msg[k + 1] << 8) | msg[k];
    res[i] = w >>> 0;
  }
  return res;
}
utils.join32 = join32;

function split32(msg, endian) {
  var res = new Array(msg.length * 4);
  for (var i = 0, k = 0; i < msg.length; i++, k += 4) {
    var m = msg[i];
    if (endian === 'big') {
      res[k] = m >>> 24;
      res[k + 1] = (m >>> 16) & 0xff;
      res[k + 2] = (m >>> 8) & 0xff;
      res[k + 3] = m & 0xff;
    } else {
      res[k + 3] = m >>> 24;
      res[k + 2] = (m >>> 16) & 0xff;
      res[k + 1] = (m >>> 8) & 0xff;
      res[k] = m & 0xff;
    }
  }
  return res;
}
utils.split32 = split32;

function rotr32(w, b) {
  return (w >>> b) | (w << (32 - b));
}
utils.rotr32 = rotr32;

function rotl32(w, b) {
  return (w << b) | (w >>> (32 - b));
}
utils.rotl32 = rotl32;

function sum32(a, b) {
  return (a + b) >>> 0;
}
utils.sum32 = sum32;

function sum32_3(a, b, c) {
  return (a + b + c) >>> 0;
}
utils.sum32_3 = sum32_3;

function sum32_4(a, b, c, d) {
  return (a + b + c + d) >>> 0;
}
utils.sum32_4 = sum32_4;

function sum32_5(a, b, c, d, e) {
  return (a + b + c + d + e) >>> 0;
}
utils.sum32_5 = sum32_5;

function assert(cond, msg) {
  if (!cond)
    throw new Error(msg || 'Assertion failed');
}
utils.assert = assert;

utils.inherits = inherits;

function sum64(buf, pos, ah, al) {
  var bh = buf[pos];
  var bl = buf[pos + 1];

  var lo = (al + bl) >>> 0;
  var hi = (lo < al ? 1 : 0) + ah + bh;
  buf[pos] = hi >>> 0;
  buf[pos + 1] = lo;
}
exports.sum64 = sum64;

function sum64_hi(ah, al, bh, bl) {
  var lo = (al + bl) >>> 0;
  var hi = (lo < al ? 1 : 0) + ah + bh;
  return hi >>> 0;
};
exports.sum64_hi = sum64_hi;

function sum64_lo(ah, al, bh, bl) {
  var lo = al + bl;
  return lo >>> 0;
};
exports.sum64_lo = sum64_lo;

function sum64_4_hi(ah, al, bh, bl, ch, cl, dh, dl) {
  var carry = 0;
  var lo = al;
  lo = (lo + bl) >>> 0;
  carry += lo < al ? 1 : 0;
  lo = (lo + cl) >>> 0;
  carry += lo < cl ? 1 : 0;
  lo = (lo + dl) >>> 0;
  carry += lo < dl ? 1 : 0;

  var hi = ah + bh + ch + dh + carry;
  return hi >>> 0;
};
exports.sum64_4_hi = sum64_4_hi;

function sum64_4_lo(ah, al, bh, bl, ch, cl, dh, dl) {
  var lo = al + bl + cl + dl;
  return lo >>> 0;
};
exports.sum64_4_lo = sum64_4_lo;

function sum64_5_hi(ah, al, bh, bl, ch, cl, dh, dl, eh, el) {
  var carry = 0;
  var lo = al;
  lo = (lo + bl) >>> 0;
  carry += lo < al ? 1 : 0;
  lo = (lo + cl) >>> 0;
  carry += lo < cl ? 1 : 0;
  lo = (lo + dl) >>> 0;
  carry += lo < dl ? 1 : 0;
  lo = (lo + el) >>> 0;
  carry += lo < el ? 1 : 0;

  var hi = ah + bh + ch + dh + eh + carry;
  return hi >>> 0;
};
exports.sum64_5_hi = sum64_5_hi;

function sum64_5_lo(ah, al, bh, bl, ch, cl, dh, dl, eh, el) {
  var lo = al + bl + cl + dl + el;

  return lo >>> 0;
};
exports.sum64_5_lo = sum64_5_lo;

function rotr64_hi(ah, al, num) {
  var r = (al << (32 - num)) | (ah >>> num);
  return r >>> 0;
};
exports.rotr64_hi = rotr64_hi;

function rotr64_lo(ah, al, num) {
  var r = (ah << (32 - num)) | (al >>> num);
  return r >>> 0;
};
exports.rotr64_lo = rotr64_lo;

function shr64_hi(ah, al, num) {
  return ah >>> num;
};
exports.shr64_hi = shr64_hi;

function shr64_lo(ah, al, num) {
  var r = (ah << (32 - num)) | (al >>> num);
  return r >>> 0;
};
exports.shr64_lo = shr64_lo;

},{"inherits":143}],48:[function(require,module,exports){
module.exports={
  "name": "elliptic",
  "version": "1.0.1",
  "description": "EC cryptography",
  "main": "lib/elliptic.js",
  "scripts": {
    "test": "mocha --reporter=spec test/*-test.js"
  },
  "repository": {
    "type": "git",
    "url": "git@github.com:indutny/elliptic"
  },
  "keywords": [
    "EC",
    "Elliptic",
    "curve",
    "Cryptography"
  ],
  "author": {
    "name": "Fedor Indutny",
    "email": "fedor@indutny.com"
  },
  "license": "MIT",
  "bugs": {
    "url": "https://github.com/indutny/elliptic/issues"
  },
  "homepage": "https://github.com/indutny/elliptic",
  "devDependencies": {
    "browserify": "^3.44.2",
    "mocha": "^1.18.2",
    "uglify-js": "^2.4.13"
  },
  "dependencies": {
    "bn.js": "^1.0.0",
    "brorand": "^1.0.1",
    "hash.js": "^1.0.0",
    "inherits": "^2.0.1"
  },
  "gitHead": "17dc013761dd1efcfb868e2b06b0b897627b40be",
  "_id": "elliptic@1.0.1",
  "_shasum": "d180376b66a17d74995c837796362ac4d22aefe3",
  "_from": "elliptic@^1.0.0",
  "_npmVersion": "1.4.28",
  "_npmUser": {
    "name": "indutny",
    "email": "fedor@indutny.com"
  },
  "maintainers": [
    {
      "name": "indutny",
      "email": "fedor@indutny.com"
    }
  ],
  "dist": {
    "shasum": "d180376b66a17d74995c837796362ac4d22aefe3",
    "tarball": "http://registry.npmjs.org/elliptic/-/elliptic-1.0.1.tgz"
  },
  "directories": {},
  "_resolved": "https://registry.npmjs.org/elliptic/-/elliptic-1.0.1.tgz"
}

},{}],49:[function(require,module,exports){
(function (Buffer){

module.exports = function evp(crypto, password, salt, keyLen) {
  keyLen = keyLen/8;
  var ki = 0;
  var ii = 0;
  var key = new Buffer(keyLen);
  var addmd = 0;
  var md, md_buf;
  var i;
  while (true) {
    md = crypto.createHash('md5');
    if(addmd++ > 0) {
       md.update(md_buf);
    }
    md.update(password);
    md.update(salt);
    md_buf = md.digest();
    i = 0;
    if(keyLen > 0) {
      while(true) {
        if(keyLen === 0) {
          break;
        }
        if(i === md_buf.length) {
          break;
        }
        key[ki++] = md_buf[i++];
        keyLen--;
       }
    }
   if(keyLen === 0) {
      break;
    }
  }
  for(i=0;i<md_buf.length;i++) {
    md_buf[i] = 0;
  }
  return key;
};
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],50:[function(require,module,exports){
module.exports={"2.16.840.1.101.3.4.1.1": "aes-128-ecb",
"2.16.840.1.101.3.4.1.2": "aes-128-cbc",
"2.16.840.1.101.3.4.1.3": "aes-128-ofb",
"2.16.840.1.101.3.4.1.4": "aes-128-cfb",
"2.16.840.1.101.3.4.1.21": "aes-192-ecb",
"2.16.840.1.101.3.4.1.22": "aes-192-cbc",
"2.16.840.1.101.3.4.1.23": "aes-192-ofb",
"2.16.840.1.101.3.4.1.24": "aes-192-cfb",
"2.16.840.1.101.3.4.1.41": "aes-256-ecb",
"2.16.840.1.101.3.4.1.42": "aes-256-cbc",
"2.16.840.1.101.3.4.1.43": "aes-256-ofb",
"2.16.840.1.101.3.4.1.44": "aes-256-cfb"
}
},{}],51:[function(require,module,exports){
// from https://github.com/indutny/self-signed/blob/gh-pages/lib/asn1.js
// Fedor, you are amazing.

var asn1 = require('asn1.js');
var rfc3280 = require('asn1.js-rfc3280');

var RSAPrivateKey = asn1.define('RSAPrivateKey', function() {
  this.seq().obj(
    this.key('version').int(),
    this.key('modulus').int(),
    this.key('publicExponent').int(),
    this.key('privateExponent').int(),
    this.key('prime1').int(),
    this.key('prime2').int(),
    this.key('exponent1').int(),
    this.key('exponent2').int(),
    this.key('coefficient').int()
  );
});
exports.RSAPrivateKey = RSAPrivateKey;

var RSAPublicKey = asn1.define('RSAPublicKey', function() {
  this.seq().obj(
    this.key('modulus').int(),
    this.key('publicExponent').int()
  );
});
exports.RSAPublicKey = RSAPublicKey;

var PublicKey = rfc3280.SubjectPublicKeyInfo;
exports.PublicKey = PublicKey;
var ECPublicKey =  asn1.define('ECPublicKey', function() {
  this.seq().obj(
    this.key('algorithm').seq().obj(
      this.key('id').objid(),
      this.key('curve').objid()
    ),
    this.key('subjectPrivateKey').bitstr()
  );
});
exports.ECPublicKey = ECPublicKey;
var ECPrivateWrap =  asn1.define('ECPrivateWrap', function() {
  this.seq().obj(
    this.key('version').int(),
    this.key('algorithm').seq().obj(
      this.key('id').objid(),
      this.key('curve').objid()
    ),
    this.key('subjectPrivateKey').octstr()
  );
});
exports.ECPrivateWrap = ECPrivateWrap;

var PrivateKeyInfo = asn1.define('PrivateKeyInfo', function() {
  this.seq().obj(
    this.key('version').int(),
    this.key('algorithm').use(rfc3280.AlgorithmIdentifier),
    this.key('subjectPrivateKey').octstr()
  );
});
exports.PrivateKey = PrivateKeyInfo;
var EncryptedPrivateKeyInfo = asn1.define('EncryptedPrivateKeyInfo', function() {
  this.seq().obj(
    this.key('algorithm').seq().obj(
      this.key('id').objid(),
      this.key('decrypt').seq().obj(
        this.key('kde').seq().obj(
          this.key('id').objid(),
          this.key('kdeparams').seq().obj(
            this.key('salt').octstr(),
            this.key('iters').int()
          )
        ),
        this.key('cipher').seq().obj(
          this.key('algo').objid(),
          this.key('iv').octstr()
        )
      )
    ),
    this.key('subjectPrivateKey').octstr()
  );
});
var dsaParams = asn1.define('dsaParams', function() {
  this.seq().obj(
    this.key('algorithm').objid(),
    this.key('parameters').seq().obj(
        this.key('p').int(),
        this.key('q').int(),
        this.key('g').int()
      )
  );
});
exports.EncryptedPrivateKey = EncryptedPrivateKeyInfo;
var DSAPublicKey = asn1.define('DSAPublicKey', function() {
  this.seq().obj(
    this.key('algorithm').use(dsaParams),
    this.key('subjectPublicKey').bitstr()
  );
});
exports.DSAPublicKey = DSAPublicKey;
var DSAPrivateWrap =  asn1.define('DSAPrivateWrap', function() {
  this.seq().obj(
    this.key('version').int(),
    this.key('algorithm').seq().obj(
      this.key('id').objid(),
      this.key('parameters').seq().obj(
        this.key('p').int(),
        this.key('q').int(),
        this.key('g').int()
      )
    ),
    this.key('subjectPrivateKey').octstr()
  );
});
exports.DSAPrivateWrap = DSAPrivateWrap;
var DSAPrivateKey = asn1.define('DSAPrivateKey', function() {
  this.seq().obj(
    this.key('version').int(),
    this.key('p').int(),
    this.key('q').int(),
    this.key('g').int(),
    this.key('pub_key').int(),
    this.key('priv_key').int()
  );
});
exports.DSAPrivateKey = DSAPrivateKey;

exports.DSAparam = asn1.define('DSAparam', function () {
  this.int();
});
var ECPrivateKey = asn1.define('ECPrivateKey', function() {
  this.seq().obj(
    this.key('version').int(),
    this.key('privateKey').octstr(),
    this.key('parameters').optional().explicit(0).use(ECParameters),
    this.key('publicKey').optional().explicit(1).bitstr()
  );
});
exports.ECPrivateKey = ECPrivateKey;
var ECParameters = asn1.define('ECParameters', function() {
  this.choice({
    namedCurve: this.objid()
  });
});

var ECPrivateKey2 = asn1.define('ECPrivateKey2', function() {
  this.seq().obj(
    this.key('version').int(),
    this.key('privateKey').octstr(),
    this.key('publicKey').seq().obj(
      this.key('key').bitstr()
    )
  );
});
exports.ECPrivateKey2 = ECPrivateKey2;

exports.signature = asn1.define('signature', function() {
  this.seq().obj(
    this.key('r').int(),
    this.key('s').int()
  );
});
},{"asn1.js":55,"asn1.js-rfc3280":54}],52:[function(require,module,exports){
(function (Buffer){
var findProc = /Proc-Type: 4,ENCRYPTED\n\r?DEK-Info: AES-((?:128)|(?:192)|(?:256))-CBC,([0-9A-H]+)\n\r?\n\r?([0-9A-z\n\r\+\/\=]+)\n\r?/m;
var startRegex = /^-----BEGIN (.*)-----\n/;
var evp = require('./EVP_BytesToKey');
module.exports = function (okey, password, crypto) {
  var key = okey.toString();
  var match = key.match(findProc);
  if (!match) {
    return okey;
  }
  var suite = 'aes' + match[1];
  var iv = new Buffer(match[2], 'hex');
  var cipherText = new Buffer(match[3].replace(/\n\r?/g, ''), 'base64');
  var cipherKey = evp(crypto, password, iv.slice(0,8), parseInt(match[1]));
  var out = [];
  var cipher = crypto.createDecipheriv(suite, cipherKey, iv);
  out.push(cipher.update(cipherText));
  out.push(cipher.final());
  var decrypted = Buffer.concat(out).toString('base64');
  var tag = key.match(startRegex)[1];
  return '-----BEGIN ' + tag + "-----\n" + wrap(decrypted) + "\n" + '-----END ' + tag + "-----\n";
};
// http://stackoverflow.com/a/7033705
function wrap(str) {
  var chunks = [];
  while (str) {
    if (str.length < 64) {
      chunks.push(str);
      break;
    }
    else {
      chunks.push(str.slice(0, 64));
      str = str.slice(64);
    }
  }
  return chunks.join("\n");
}
}).call(this,require("buffer").Buffer)
},{"./EVP_BytesToKey":49,"buffer":"buffer"}],53:[function(require,module,exports){
(function (Buffer){
var pemstrip = require('pemstrip');
var asn1 = require('./asn1');
var aesid = require('./aesid.json');
var fixProc = require('./fixProc');
module.exports = parseKeys;

function parseKeys(buffer, crypto) {
  var password;
  if (typeof buffer === 'object' && !Buffer.isBuffer(buffer)) {
    password = buffer.passphrase;
    buffer = buffer.key;
  }
  if (typeof buffer === 'string') {
    buffer = new Buffer(buffer);
  }
  if (password) {
    buffer = fixProc(buffer, password, crypto);
  }
  var stripped = pemstrip.strip(buffer);
  var type = stripped.tag;
  var data = new Buffer(stripped.base64, 'base64');
  var subtype,ndata;
  switch (type) {
    case 'PUBLIC KEY':
      ndata = asn1.PublicKey.decode(data, 'der');
      subtype = ndata.algorithm.algorithm.join('.');
      switch(subtype) {
        case '1.2.840.113549.1.1.1':
          return asn1.RSAPublicKey.decode(ndata.subjectPublicKey.data, 'der');
        case '1.2.840.10045.2.1':
          return {
            type: 'ec',
            data:  asn1.ECPublicKey.decode(data, 'der')
          };
        case '1.2.840.10040.4.1':
          ndata = asn1.DSAPublicKey.decode(data, 'der');
          ndata.algorithm.parameters.pub_key = asn1.DSAparam.decode(ndata.subjectPublicKey.data, 'der');
          return {
            type: 'dsa',
            data: ndata.algorithm.parameters
          };
        default: throw new Error('unknown key id ' +  subtype);
      }
      throw new Error('unknown key type ' +  type);
    case 'ENCRYPTED PRIVATE KEY':
      data = asn1.EncryptedPrivateKey.decode(data, 'der');
      data = decrypt(crypto, data, password);
      //falling through
    case 'PRIVATE KEY':
      ndata = asn1.PrivateKey.decode(data, 'der');
      subtype = ndata.algorithm.algorithm.join('.');
      switch(subtype) {
        case '1.2.840.113549.1.1.1':
          return asn1.RSAPrivateKey.decode(ndata.subjectPrivateKey, 'der');
        case '1.2.840.10045.2.1':
          ndata =  asn1.ECPrivateWrap.decode(data, 'der');
          return {
            curve: ndata.algorithm.curve,
            privateKey: asn1.ECPrivateKey.decode(ndata.subjectPrivateKey, 'der').privateKey
          };
        case '1.2.840.10040.4.1':
          ndata =  asn1.DSAPrivateWrap.decode(data, 'der');
          ndata.algorithm.parameters.priv_key = asn1.DSAparam.decode(ndata.subjectPrivateKey, 'der');
          return {
            type: 'dsa',
            params: ndata.algorithm.parameters
          };
        default: throw new Error('unknown key id ' +  subtype);
      }
      throw new Error('unknown key type ' +  type);
    case 'RSA PUBLIC KEY':
      return asn1.RSAPublicKey.decode(data, 'der');
    case 'RSA PRIVATE KEY':
      return asn1.RSAPrivateKey.decode(data, 'der');
    case 'DSA PRIVATE KEY':
      return {
        type: 'dsa',
        params: asn1.DSAPrivateKey.decode(data, 'der')
      };
    case 'EC PRIVATE KEY':
      data = asn1.ECPrivateKey.decode(data, 'der');
      return {
        curve: data.parameters.value,
        privateKey: data.privateKey
      };
    default: throw new Error('unknown key type ' +  type);
  }
}
parseKeys.signature = asn1.signature;
function decrypt(crypto, data, password) {
  var salt = data.algorithm.decrypt.kde.kdeparams.salt;
  var iters = data.algorithm.decrypt.kde.kdeparams.iters;
  var algo = aesid[data.algorithm.decrypt.cipher.algo.join('.')];
  var iv = data.algorithm.decrypt.cipher.iv;
  var cipherText = data.subjectPrivateKey;
  var keylen = parseInt(algo.split('-')[1], 10)/8;
  var key = crypto.pbkdf2Sync(password, salt, iters, keylen);
  var cipher = crypto.createDecipheriv(algo, key, iv);
  var out = [];
  out.push(cipher.update(cipherText));
  out.push(cipher.final());
  return Buffer.concat(out);
}
}).call(this,require("buffer").Buffer)
},{"./aesid.json":50,"./asn1":51,"./fixProc":52,"buffer":"buffer","pemstrip":68}],54:[function(require,module,exports){
try {
  var asn1 = require('asn1.js');
} catch (e) {
  var asn1 = require('../' + '..');
}

var CRLReason = asn1.define('CRLReason', function() {
  this.enum({
    0: 'unspecified',
    1: 'keyCompromise',
    2: 'CACompromise',
    3: 'affiliationChanged',
    4: 'superseded',
    5: 'cessationOfOperation',
    6: 'certificateHold',
    8: 'removeFromCRL',
    9: 'privilegeWithdrawn',
    10: 'AACompromise'
  });
});
exports.CRLReason = CRLReason;

var AlgorithmIdentifier = asn1.define('AlgorithmIdentifier', function() {
  this.seq().obj(
    this.key('algorithm').objid(),
    this.key('parameters').optional().any()
  );
});
exports.AlgorithmIdentifier = AlgorithmIdentifier;

var Certificate = asn1.define('Certificate', function() {
  this.seq().obj(
    this.key('tbsCertificate').use(TBSCertificate),
    this.key('signatureAlgorithm').use(AlgorithmIdentifier),
    this.key('signature').bitstr()
  );
});
exports.Certificate = Certificate;

var TBSCertificate = asn1.define('TBSCertificate', function() {
  this.seq().obj(
    this.key('version').def('v1').explicit(0).use(Version),
    this.key('serialNumber').use(CertificateSerialNumber),
    this.key('signature').use(AlgorithmIdentifier),
    this.key('issuer').use(Name),
    this.key('validity').use(Validity),
    this.key('subject').use(Name),
    this.key('subjectPublicKeyInfo').use(SubjectPublicKeyInfo),

    // TODO(indutny): validate that version is v2 or v3
    this.key('issuerUniqueID').optional().explicit(1).use(UniqueIdentifier),
    this.key('subjectUniqueID').optional().explicit(2).use(UniqueIdentifier),

    // TODO(indutny): validate that version is v3
    this.key('extensions').optional().explicit(3).use(Extensions)
  );
});
exports.TBSCertificate = TBSCertificate;

var Version = asn1.define('Version', function() {
  this.int({
    0: 'v1',
    1: 'v2',
    2: 'v3'
  });
});
exports.Version = Version;

var CertificateSerialNumber = asn1.define('CertificateSerialNumber',
                                          function() {
  this.int();
});
exports.CertificateSerialNumber = CertificateSerialNumber;

var Validity = asn1.define('Validity', function() {
  this.seq().obj(
    this.key('notBefore').use(Time),
    this.key('notAfter').use(Time)
  );
});
exports.Validity = Validity;

var Time = asn1.define('Time', function() {
  this.choice({
    utcTime: this.utctime(),
    genTime: this.gentime()
  });
});
exports.Time = Time;

var UniqueIdentifier = asn1.define('UniqueIdentifier', function() {
  this.bitstr();
});
exports.UniqueIdentifier = UniqueIdentifier;

var SubjectPublicKeyInfo = asn1.define('SubjectPublicKeyInfo', function() {
  this.seq().obj(
    this.key('algorithm').use(AlgorithmIdentifier),
    this.key('subjectPublicKey').bitstr()
  );
});
exports.SubjectPublicKeyInfo = SubjectPublicKeyInfo;

var Extensions = asn1.define('Extensions', function() {
  this.seqof(Extension);
});
exports.Extensions = Extensions;

var Extension = asn1.define('Extension', function() {
  this.seq().obj(
    this.key('extnID').objid(),
    this.key('critical').bool().def(false),
    this.key('extnValue').octstr()
  );
});
exports.Extension = Extension;

var Name = asn1.define('Name', function() {
  this.choice({
    rdn: this.use(RDNSequence)
  });
});
exports.Name = Name;

var RDNSequence = asn1.define('RDNSequence', function() {
  this.seqof(RelativeDistinguishedName);
});
exports.RDNSequence = RDNSequence;

var RelativeDistinguishedName = asn1.define('RelativeDistinguishedName',
                                            function() {
  this.setof(AttributeTypeAndValue);
});
exports.RelativeDistinguishedName = RelativeDistinguishedName;

var AttributeTypeAndValue = asn1.define('AttributeTypeAndValue', function() {
  this.seq().obj(
    this.key('type').use(AttributeType),
    this.key('value').use(AttributeValue)
  );
});
exports.AttributeTypeAndValue = AttributeTypeAndValue;

var AttributeType = asn1.define('AttributeType', function() {
  this.objid();
});
exports.AttributeType = AttributeType;

var AttributeValue = asn1.define('AttributeValue', function() {
  this.any();
});
exports.AttributeValue = AttributeValue;

},{"asn1.js":55}],55:[function(require,module,exports){
var asn1 = exports;

asn1.bignum = require('bn.js');

asn1.define = require('./asn1/api').define;
asn1.base = require('./asn1/base');
asn1.constants = require('./asn1/constants');
asn1.decoders = require('./asn1/decoders');
asn1.encoders = require('./asn1/encoders');

},{"./asn1/api":56,"./asn1/base":58,"./asn1/constants":62,"./asn1/decoders":64,"./asn1/encoders":66,"bn.js":27}],56:[function(require,module,exports){
var asn1 = require('../asn1');
var inherits = require('inherits');
var vm = require('vm');

var api = exports;

api.define = function define(name, body) {
  return new Entity(name, body);
};

function Entity(name, body) {
  this.name = name;
  this.body = body;

  this.decoders = {};
  this.encoders = {};
};

Entity.prototype._createNamed = function createNamed(base) {
  var named = vm.runInThisContext('(function ' + this.name + '(entity) {\n' +
    '  this._initNamed(entity);\n' +
    '})');
  inherits(named, base);
  named.prototype._initNamed = function initnamed(entity) {
    base.call(this, entity);
  };

  return new named(this);
};

Entity.prototype._getDecoder = function _getDecoder(enc) {
  // Lazily create decoder
  if (!this.decoders.hasOwnProperty(enc))
    this.decoders[enc] = this._createNamed(asn1.decoders[enc]);
  return this.decoders[enc];
};

Entity.prototype.decode = function decode(data, enc, options) {
  return this._getDecoder(enc).decode(data, options);
};

Entity.prototype._getEncoder = function _getEncoder(enc) {
  // Lazily create encoder
  if (!this.encoders.hasOwnProperty(enc))
    this.encoders[enc] = this._createNamed(asn1.encoders[enc]);
  return this.encoders[enc];
};

Entity.prototype.encode = function encode(data, enc, /* internal */ reporter) {
  return this._getEncoder(enc).encode(data, reporter);
};

},{"../asn1":55,"inherits":143,"vm":163}],57:[function(require,module,exports){
var inherits = require('inherits');
var Reporter = require('../base').Reporter;
var Buffer = require('buffer').Buffer;

function DecoderBuffer(base, options) {
  Reporter.call(this, options);
  if (!Buffer.isBuffer(base)) {
    this.error('Input not Buffer');
    return;
  }

  this.base = base;
  this.offset = 0;
  this.length = base.length;
}
inherits(DecoderBuffer, Reporter);
exports.DecoderBuffer = DecoderBuffer;

DecoderBuffer.prototype.save = function save() {
  return { offset: this.offset };
};

DecoderBuffer.prototype.restore = function restore(save) {
  // Return skipped data
  var res = new DecoderBuffer(this.base);
  res.offset = save.offset;
  res.length = this.offset;

  this.offset = save.offset;

  return res;
};

DecoderBuffer.prototype.isEmpty = function isEmpty() {
  return this.offset === this.length;
};

DecoderBuffer.prototype.readUInt8 = function readUInt8(fail) {
  if (this.offset + 1 <= this.length)
    return this.base.readUInt8(this.offset++, true);
  else
    return this.error(fail || 'DecoderBuffer overrun');
}

DecoderBuffer.prototype.skip = function skip(bytes, fail) {
  if (!(this.offset + bytes <= this.length))
    return this.error(fail || 'DecoderBuffer overrun');

  var res = new DecoderBuffer(this.base);

  // Share reporter state
  res._reporterState = this._reporterState;

  res.offset = this.offset;
  res.length = this.offset + bytes;
  this.offset += bytes;
  return res;
}

DecoderBuffer.prototype.raw = function raw(save) {
  return this.base.slice(save ? save.offset : this.offset, this.length);
}

function EncoderBuffer(value, reporter) {
  if (Array.isArray(value)) {
    this.length = 0;
    this.value = value.map(function(item) {
      if (!(item instanceof EncoderBuffer))
        item = new EncoderBuffer(item, reporter);
      this.length += item.length;
      return item;
    }, this);
  } else if (typeof value === 'number') {
    if (!(0 <= value && value <= 0xff))
      return reporter.error('non-byte EncoderBuffer value');
    this.value = value;
    this.length = 1;
  } else if (typeof value === 'string') {
    this.value = value;
    this.length = Buffer.byteLength(value);
  } else if (Buffer.isBuffer(value)) {
    this.value = value;
    this.length = value.length;
  } else {
    return reporter.error('Unsupported type: ' + typeof value);
  }
}
exports.EncoderBuffer = EncoderBuffer;

EncoderBuffer.prototype.join = function join(out, offset) {
  if (!out)
    out = new Buffer(this.length);
  if (!offset)
    offset = 0;

  if (this.length === 0)
    return out;

  if (Array.isArray(this.value)) {
    this.value.forEach(function(item) {
      item.join(out, offset);
      offset += item.length;
    });
  } else {
    if (typeof this.value === 'number')
      out[offset] = this.value;
    else if (typeof this.value === 'string')
      out.write(this.value, offset);
    else if (Buffer.isBuffer(this.value))
      this.value.copy(out, offset);
    offset += this.length;
  }

  return out;
};

},{"../base":58,"buffer":"buffer","inherits":143}],58:[function(require,module,exports){
var base = exports;

base.Reporter = require('./reporter').Reporter;
base.DecoderBuffer = require('./buffer').DecoderBuffer;
base.EncoderBuffer = require('./buffer').EncoderBuffer;
base.Node = require('./node');

},{"./buffer":57,"./node":59,"./reporter":60}],59:[function(require,module,exports){
var Reporter = require('../base').Reporter;
var EncoderBuffer = require('../base').EncoderBuffer;
var assert = require('minimalistic-assert');

// Supported tags
var tags = [
  'seq', 'seqof', 'set', 'setof', 'octstr', 'bitstr', 'objid', 'bool',
  'gentime', 'utctime', 'null_', 'enum', 'int', 'ia5str'
];

// Public methods list
var methods = [
  'key', 'obj', 'use', 'optional', 'explicit', 'implicit', 'def', 'choice',
  'any'
].concat(tags);

// Overrided methods list
var overrided = [
  '_peekTag', '_decodeTag', '_use',
  '_decodeStr', '_decodeObjid', '_decodeTime',
  '_decodeNull', '_decodeInt', '_decodeBool', '_decodeList',

  '_encodeComposite', '_encodeStr', '_encodeObjid', '_encodeTime',
  '_encodeNull', '_encodeInt', '_encodeBool'
];

function Node(enc, parent) {
  var state = {};
  this._baseState = state;

  state.enc = enc;

  state.parent = parent || null;
  state.children = null;

  // State
  state.tag = null;
  state.args = null;
  state.reverseArgs = null;
  state.choice = null;
  state.optional = false;
  state.any = false;
  state.obj = false;
  state.use = null;
  state.useDecoder = null;
  state.key = null;
  state['default'] = null;
  state.explicit = null;
  state.implicit = null;

  // Should create new instance on each method
  if (!state.parent) {
    state.children = [];
    this._wrap();
  }
}
module.exports = Node;

var stateProps = [
  'enc', 'parent', 'children', 'tag', 'args', 'reverseArgs', 'choice',
  'optional', 'any', 'obj', 'use', 'alteredUse', 'key', 'default', 'explicit',
  'implicit'
];

Node.prototype.clone = function clone() {
  var state = this._baseState;
  var cstate = {};
  stateProps.forEach(function(prop) {
    cstate[prop] = state[prop];
  });
  var res = new this.constructor(cstate.parent);
  res._baseState = cstate;
  return res;
};

Node.prototype._wrap = function wrap() {
  var state = this._baseState;
  methods.forEach(function(method) {
    this[method] = function _wrappedMethod() {
      var clone = new this.constructor(this);
      state.children.push(clone);
      return clone[method].apply(clone, arguments);
    };
  }, this);
};

Node.prototype._init = function init(body) {
  var state = this._baseState;

  assert(state.parent === null);
  body.call(this);

  // Filter children
  state.children = state.children.filter(function(child) {
    return child._baseState.parent === this;
  }, this);
  assert.equal(state.children.length, 1, 'Root node can have only one child');
};

Node.prototype._useArgs = function useArgs(args) {
  var state = this._baseState;

  // Filter children and args
  var children = args.filter(function(arg) {
    return arg instanceof this.constructor;
  }, this);
  args = args.filter(function(arg) {
    return !(arg instanceof this.constructor);
  }, this);

  if (children.length !== 0) {
    assert(state.children === null);
    state.children = children;

    // Replace parent to maintain backward link
    children.forEach(function(child) {
      child._baseState.parent = this;
    }, this);
  }
  if (args.length !== 0) {
    assert(state.args === null);
    state.args = args;
    state.reverseArgs = args.map(function(arg) {
      if (typeof arg !== 'object' || arg.constructor !== Object)
        return arg;

      var res = {};
      Object.keys(arg).forEach(function(key) {
        if (key == (key | 0))
          key |= 0;
        var value = arg[key];
        res[value] = key;
      });
      return res;
    });
  }
};

//
// Overrided methods
//

overrided.forEach(function(method) {
  Node.prototype[method] = function _overrided() {
    var state = this._baseState;
    throw new Error(method + ' not implemented for encoding: ' + state.enc);
  };
});

//
// Public methods
//

tags.forEach(function(tag) {
  Node.prototype[tag] = function _tagMethod() {
    var state = this._baseState;
    var args = Array.prototype.slice.call(arguments);

    assert(state.tag === null);
    state.tag = tag;

    this._useArgs(args);

    return this;
  };
});

Node.prototype.use = function use(item) {
  var state = this._baseState;

  assert(state.use === null);
  state.use = item;

  return this;
};

Node.prototype.optional = function optional() {
  var state = this._baseState;

  state.optional = true;

  return this;
};

Node.prototype.def = function def(val) {
  var state = this._baseState;

  assert(state['default'] === null);
  state['default'] = val;
  state.optional = true;

  return this;
};

Node.prototype.explicit = function explicit(num) {
  var state = this._baseState;

  assert(state.explicit === null && state.implicit === null);
  state.explicit = num;

  return this;
};

Node.prototype.implicit = function implicit(num) {
  var state = this._baseState;

  assert(state.explicit === null && state.implicit === null);
  state.implicit = num;

  return this;
};

Node.prototype.obj = function obj() {
  var state = this._baseState;
  var args = Array.prototype.slice.call(arguments);

  state.obj = true;

  if (args.length !== 0)
    this._useArgs(args);

  return this;
};

Node.prototype.key = function key(newKey) {
  var state = this._baseState;

  assert(state.key === null);
  state.key = newKey;

  return this;
};

Node.prototype.any = function any() {
  var state = this._baseState;

  state.any = true;

  return this;
};

Node.prototype.choice = function choice(obj) {
  var state = this._baseState;

  assert(state.choice === null);
  state.choice = obj;
  this._useArgs(Object.keys(obj).map(function(key) {
    return obj[key];
  }));

  return this;
};

//
// Decoding
//

Node.prototype._decode = function decode(input) {
  var state = this._baseState;

  // Decode root node
  if (state.parent === null)
    return input.wrapResult(state.children[0]._decode(input));

  var result = state['default'];
  var present = true;

  var prevKey;
  if (state.key !== null)
    prevKey = input.enterKey(state.key);

  // Check if tag is there
  if (state.optional) {
    present = this._peekTag(
      input,
      state.explicit !== null ? state.explicit :
          state.implicit !== null ? state.implicit :
              state.tag || 0
    );
    if (input.isError(present))
      return present;
  }

  // Push object on stack
  var prevObj;
  if (state.obj && present)
    prevObj = input.enterObject();

  if (present) {
    // Unwrap explicit values
    if (state.explicit !== null) {
      var explicit = this._decodeTag(input, state.explicit);
      if (input.isError(explicit))
        return explicit;
      input = explicit;
    }

    // Unwrap implicit and normal values
    if (state.use === null && state.choice === null) {
      if (state.any)
        var save = input.save();
      var body = this._decodeTag(
        input,
        state.implicit !== null ? state.implicit : state.tag,
        state.any
      );
      if (input.isError(body))
        return body;

      if (state.any)
        result = input.raw(save);
      else
        input = body;
    }

    // Select proper method for tag
    if (state.any)
      result = result;
    else if (state.choice === null)
      result = this._decodeGeneric(state.tag, input);
    else
      result = this._decodeChoice(input);

    if (input.isError(result))
      return result;

    // Decode children
    if (!state.any && state.choice === null && state.children !== null) {
      var fail = state.children.some(function decodeChildren(child) {
        // NOTE: We are ignoring errors here, to let parser continue with other
        // parts of encoded data
        child._decode(input);
      });
      if (fail)
        return err;
    }
  }

  // Pop object
  if (state.obj && present)
    result = input.leaveObject(prevObj);

  // Set key
  if (state.key !== null && (result !== null || present === true))
    input.leaveKey(prevKey, state.key, result);

  return result;
};

Node.prototype._decodeGeneric = function decodeGeneric(tag, input) {
  var state = this._baseState;

  if (tag === 'seq' || tag === 'set')
    return null;
  if (tag === 'seqof' || tag === 'setof')
    return this._decodeList(input, tag, state.args[0]);
  else if (tag === 'octstr' || tag === 'bitstr' || tag === 'ia5str')
    return this._decodeStr(input, tag);
  else if (tag === 'objid' && state.args)
    return this._decodeObjid(input, state.args[0], state.args[1]);
  else if (tag === 'objid')
    return this._decodeObjid(input, null, null);
  else if (tag === 'gentime' || tag === 'utctime')
    return this._decodeTime(input, tag);
  else if (tag === 'null_')
    return this._decodeNull(input);
  else if (tag === 'bool')
    return this._decodeBool(input);
  else if (tag === 'int' || tag === 'enum')
    return this._decodeInt(input, state.args && state.args[0]);
  else if (state.use !== null)
    return this._getUse(state.use, input._reporterState.obj)._decode(input);
  else
    return input.error('unknown tag: ' + tag);

  return null;
};

Node.prototype._getUse = function _getUse(entity, obj) {

  var state = this._baseState;
  // Create altered use decoder if implicit is set
  state.useDecoder = this._use(entity, obj);
  assert(state.useDecoder._baseState.parent === null);
  state.useDecoder = state.useDecoder._baseState.children[0];
  if (state.implicit !== state.useDecoder._baseState.implicit) {
    state.useDecoder = state.useDecoder.clone();
    state.useDecoder._baseState.implicit = state.implicit;
  }
  return state.useDecoder;
};

Node.prototype._decodeChoice = function decodeChoice(input) {
  var state = this._baseState;
  var result = null;
  var match = false;

  Object.keys(state.choice).some(function(key) {
    var save = input.save();
    var node = state.choice[key];
    try {
      var value = node._decode(input);
      if (input.isError(value))
        return false;

      result = { type: key, value: value };
      match = true;
    } catch (e) {
      input.restore(save);
      return false;
    }
    return true;
  }, this);

  if (!match)
    return input.error('Choice not matched');

  return result;
};

//
// Encoding
//

Node.prototype._createEncoderBuffer = function createEncoderBuffer(data) {
  return new EncoderBuffer(data, this.reporter);
};

Node.prototype._encode = function encode(data, reporter, parent) {
  var state = this._baseState;
  if (state['default'] !== null && state['default'] === data)
    return;

  var result = this._encodeValue(data, reporter, parent);
  if (result === undefined)
    return;

  if (this._skipDefault(result, reporter, parent))
    return;

  return result;
};

Node.prototype._encodeValue = function encode(data, reporter, parent) {
  var state = this._baseState;

  // Decode root node
  if (state.parent === null)
    return state.children[0]._encode(data, reporter || new Reporter());

  var result = null;
  var present = true;

  // Set reporter to share it with a child class
  this.reporter = reporter;

  // Check if data is there
  if (state.optional && data === undefined) {
    if (state['default'] !== null)
      data = state['default']
    else
      return;
  }

  // For error reporting
  var prevKey;

  // Encode children first
  var content = null;
  var primitive = false;
  if (state.any) {
    // Anything that was given is translated to buffer
    result = this._createEncoderBuffer(data);
  } else if (state.choice) {
    result = this._encodeChoice(data, reporter);
  } else if (state.children) {
    content = state.children.map(function(child) {
      if (child._baseState.tag === 'null_')
        return child._encode(null, reporter, data);

      if (child._baseState.key === null)
        return reporter.error('Child should have a key');
      var prevKey = reporter.enterKey(child._baseState.key);

      if (typeof data !== 'object')
        return reporter.error('Child expected, but input is not object');

      var res = child._encode(data[child._baseState.key], reporter, data);
      reporter.leaveKey(prevKey);

      return res;
    }, this).filter(function(child) {
      return child;
    });

    content = this._createEncoderBuffer(content);
  } else {
    if (state.tag === 'seqof' || state.tag === 'setof') {
      // TODO(indutny): this should be thrown on DSL level
      if (!(state.args && state.args.length === 1))
        return reporter.error('Too many args for : ' + state.tag);

      if (!Array.isArray(data))
        return reporter.error('seqof/setof, but data is not Array');

      var child = this.clone();
      child._baseState.implicit = null;
      content = this._createEncoderBuffer(data.map(function(item) {
        var state = this._baseState;

        return this._getUse(state.args[0], data)._encode(item, reporter);
      }, child));
    } else if (state.use !== null) {
      result = this._getUse(state.use, parent)._encode(data, reporter);
    } else {
      content = this._encodePrimitive(state.tag, data);
      primitive = true;
    }
  }

  // Encode data itself
  var result;
  if (!state.any && state.choice === null) {
    var tag = state.implicit !== null ? state.implicit : state.tag;
    var cls = state.implicit === null ? 'universal' : 'context';

    if (tag === null) {
      if (state.use === null)
        reporter.error('Tag could be ommited only for .use()');
    } else {
      if (state.use === null)
        result = this._encodeComposite(tag, primitive, cls, content);
    }
  }

  // Wrap in explicit
  if (state.explicit !== null)
    result = this._encodeComposite(state.explicit, false, 'context', result);

  return result;
};

Node.prototype._encodeChoice = function encodeChoice(data, reporter) {
  var state = this._baseState;

  var node = state.choice[data.type];
  if (!node) {
    assert(
        false,
        data.type + ' not found in ' +
            JSON.stringify(Object.keys(state.choice)));
  }
  return node._encode(data.value, reporter);
};

Node.prototype._encodePrimitive = function encodePrimitive(tag, data) {
  var state = this._baseState;

  if (tag === 'octstr' || tag === 'bitstr' || tag === 'ia5str')
    return this._encodeStr(data, tag);
  else if (tag === 'objid' && state.args)
    return this._encodeObjid(data, state.reverseArgs[0], state.args[1]);
  else if (tag === 'objid')
    return this._encodeObjid(data, null, null);
  else if (tag === 'gentime' || tag === 'utctime')
    return this._encodeTime(data, tag);
  else if (tag === 'null_')
    return this._encodeNull();
  else if (tag === 'int' || tag === 'enum')
    return this._encodeInt(data, state.args && state.reverseArgs[0]);
  else if (tag === 'bool')
    return this._encodeBool(data);
  else
    throw new Error('Unsupported tag: ' + tag);
};

},{"../base":58,"minimalistic-assert":67}],60:[function(require,module,exports){
var inherits = require('inherits');

function Reporter(options) {
  this._reporterState = {
    obj: null,
    path: [],
    options: options || {},
    errors: []
  };
}
exports.Reporter = Reporter;

Reporter.prototype.isError = function isError(obj) {
  return obj instanceof ReporterError;
};

Reporter.prototype.enterKey = function enterKey(key) {
  return this._reporterState.path.push(key);
};

Reporter.prototype.leaveKey = function leaveKey(index, key, value) {
  var state = this._reporterState;

  state.path = state.path.slice(0, index - 1);
  if (state.obj !== null)
    state.obj[key] = value;
};

Reporter.prototype.enterObject = function enterObject() {
  var state = this._reporterState;

  var prev = state.obj;
  state.obj = {};
  return prev;
};

Reporter.prototype.leaveObject = function leaveObject(prev) {
  var state = this._reporterState;

  var now = state.obj;
  state.obj = prev;
  return now;
};

Reporter.prototype.error = function error(msg) {
  var err;
  var state = this._reporterState;

  var inherited = msg instanceof ReporterError;
  if (inherited) {
    err = msg;
  } else {
    err = new ReporterError(state.path.map(function(elem) {
      return '[' + JSON.stringify(elem) + ']';
    }).join(''), msg.message || msg, msg.stack);
  }

  if (!state.options.partial)
    throw err;

  if (!inherited)
    state.errors.push(err);

  return err;
};

Reporter.prototype.wrapResult = function wrapResult(result) {
  var state = this._reporterState;
  if (!state.options.partial)
    return result;

  return {
    result: this.isError(result) ? null : result,
    errors: state.errors
  };
};

function ReporterError(path, msg) {
  this.path = path;
  this.rethrow(msg);
};
inherits(ReporterError, Error);

ReporterError.prototype.rethrow = function rethrow(msg) {
  this.message = msg + ' at: ' + (this.path || '(shallow)');
  Error.captureStackTrace(this, ReporterError);

  return this;
};

},{"inherits":143}],61:[function(require,module,exports){
var constants = require('../constants');

exports.tagClass = {
  0: 'universal',
  1: 'application',
  2: 'context',
  3: 'private'
};
exports.tagClassByName = constants._reverse(exports.tagClass);

exports.tag = {
  0x00: 'end',
  0x01: 'bool',
  0x02: 'int',
  0x03: 'bitstr',
  0x04: 'octstr',
  0x05: 'null_',
  0x06: 'objid',
  0x07: 'objDesc',
  0x08: 'external',
  0x09: 'real',
  0x0a: 'enum',
  0x0b: 'embed',
  0x0c: 'utf8str',
  0x0d: 'relativeOid',
  0x10: 'seq',
  0x11: 'set',
  0x12: 'numstr',
  0x13: 'printstr',
  0x14: 't61str',
  0x15: 'videostr',
  0x16: 'ia5str',
  0x17: 'utctime',
  0x18: 'gentime',
  0x19: 'graphstr',
  0x1a: 'iso646str',
  0x1b: 'genstr',
  0x1c: 'unistr',
  0x1d: 'charstr',
  0x1e: 'bmpstr'
};
exports.tagByName = constants._reverse(exports.tag);

},{"../constants":62}],62:[function(require,module,exports){
var constants = exports;

// Helper
constants._reverse = function reverse(map) {
  var res = {};

  Object.keys(map).forEach(function(key) {
    // Convert key to integer if it is stringified
    if ((key | 0) == key)
      key = key | 0;

    var value = map[key];
    res[value] = key;
  });

  return res;
};

constants.der = require('./der');

},{"./der":61}],63:[function(require,module,exports){
var inherits = require('inherits');

var asn1 = require('../../asn1');
var base = asn1.base;
var bignum = asn1.bignum;

// Import DER constants
var der = asn1.constants.der;

function DERDecoder(entity) {
  this.enc = 'der';
  this.name = entity.name;
  this.entity = entity;

  // Construct base tree
  this.tree = new DERNode();
  this.tree._init(entity.body);
};
module.exports = DERDecoder;

DERDecoder.prototype.decode = function decode(data, options) {
  if (!(data instanceof base.DecoderBuffer))
    data = new base.DecoderBuffer(data, options);

  return this.tree._decode(data, options);
};

// Tree methods

function DERNode(parent) {
  base.Node.call(this, 'der', parent);
}
inherits(DERNode, base.Node);

DERNode.prototype._peekTag = function peekTag(buffer, tag) {
  if (buffer.isEmpty())
    return false;

  var state = buffer.save();
  var decodedTag = derDecodeTag(buffer, 'Failed to peek tag: "' + tag + '"');
  if (buffer.isError(decodedTag))
    return decodedTag;

  buffer.restore(state);

  return decodedTag.tag === tag || decodedTag.tagStr === tag;
};

DERNode.prototype._decodeTag = function decodeTag(buffer, tag, any) {
  var decodedTag = derDecodeTag(buffer,
                                'Failed to decode tag of "' + tag + '"');
  if (buffer.isError(decodedTag))
    return decodedTag;

  var len = derDecodeLen(buffer,
                         decodedTag.primitive,
                         'Failed to get length of "' + tag + '"');

  // Failure
  if (buffer.isError(len))
    return len;

  if (!any &&
      decodedTag.tag !== tag &&
      decodedTag.tagStr !== tag &&
      decodedTag.tagStr + 'of' !== tag) {
    return buffer.error('Failed to match tag: "' + tag + '"');
  }

  if (decodedTag.primitive || len !== null)
    return buffer.skip(len, 'Failed to match body of: "' + tag + '"');

  // Indefinite length... find END tag
  var state = buffer.start();
  var res = this._skipUntilEnd(
      buffer,
      'Failed to skip indefinite length body: "' + this.tag + '"');
  if (buffer.isError(res))
    return res;

  return buffer.cut(state);
};

DERNode.prototype._skipUntilEnd = function skipUntilEnd(buffer, fail) {
  while (true) {
    var tag = derDecodeTag(buffer, fail);
    if (buffer.isError(tag))
      return tag;
    var len = derDecodeLen(buffer, tag.primitive, fail);
    if (buffer.isError(len))
      return len;

    var res;
    if (tag.primitive || len !== null)
      res = buffer.skip(len)
    else
      res = this._skipUntilEnd(buffer, fail);

    // Failure
    if (buffer.isError(res))
      return res;

    if (tag.tagStr === 'end')
      break;
  }
};

DERNode.prototype._decodeList = function decodeList(buffer, tag, decoder) {
  var result = [];
  while (!buffer.isEmpty()) {
    var possibleEnd = this._peekTag(buffer, 'end');
    if (buffer.isError(possibleEnd))
      return possibleEnd;

    var res = decoder.decode(buffer, 'der');
    if (buffer.isError(res) && possibleEnd)
      break;
    result.push(res);
  }
  return result;
};

DERNode.prototype._decodeStr = function decodeStr(buffer, tag) {
  if (tag === 'octstr') {
    return buffer.raw();
  } else if (tag === 'bitstr') {
    var unused = buffer.readUInt8();
    if (buffer.isError(unused))
      return unused;

    return { unused: unused, data: buffer.raw() };
  } else if (tag === 'ia5str') {
    return buffer.raw().toString();
  } else {
    return this.error('Decoding of string type: ' + tag + ' unsupported');
  }
};

DERNode.prototype._decodeObjid = function decodeObjid(buffer, values, relative) {
  var identifiers = [];
  var ident = 0;
  while (!buffer.isEmpty()) {
    var subident = buffer.readUInt8();
    ident <<= 7;
    ident |= subident & 0x7f;
    if ((subident & 0x80) === 0) {
      identifiers.push(ident);
      ident = 0;
    }
  }
  if (subident & 0x80)
    identifiers.push(ident);

  var first = (identifiers[0] / 40) | 0;
  var second = identifiers[0] % 40;

  if (relative)
    result = identifiers;
  else
    result = [first, second].concat(identifiers.slice(1));

  if (values)
    result = values[result.join(' ')];

  return result;
};

DERNode.prototype._decodeTime = function decodeTime(buffer, tag) {
  var str = buffer.raw().toString();
  if (tag === 'gentime') {
    var year = str.slice(0, 4) | 0;
    var mon = str.slice(4, 6) | 0;
    var day = str.slice(6, 8) | 0;
    var hour = str.slice(8, 10) | 0;
    var min = str.slice(10, 12) | 0;
    var sec = str.slice(12, 14) | 0;
  } else if (tag === 'utctime') {
    var year = str.slice(0, 2) | 0;
    var mon = str.slice(2, 4) | 0;
    var day = str.slice(4, 6) | 0;
    var hour = str.slice(6, 8) | 0;
    var min = str.slice(8, 10) | 0;
    var sec = str.slice(10, 12) | 0;
    if (year < 70)
      year = 2000 + year;
    else
      year = 1900 + year;
  } else {
    return this.error('Decoding ' + tag + ' time is not supported yet');
  }

  return Date.UTC(year, mon - 1, day, hour, min, sec, 0);
};

DERNode.prototype._decodeNull = function decodeNull(buffer) {
  return null;
};

DERNode.prototype._decodeBool = function decodeBool(buffer) {
  var res = buffer.readUInt8();
  if (buffer.isError(res))
    return res;
  else
    return res !== 0;
};

DERNode.prototype._decodeInt = function decodeInt(buffer, values) {
  var res = 0;

  // Bigint, return as it is (assume big endian)
  var raw = buffer.raw();
  if (raw.length > 3)
    return new bignum(raw);

  while (!buffer.isEmpty()) {
    res <<= 8;
    var i = buffer.readUInt8();
    if (buffer.isError(i))
      return i;
    res |= i;
  }

  if (values)
    res = values[res] || res;

  return res;
};

DERNode.prototype._use = function use(entity, obj) {
  if (typeof entity === 'function')
    entity = entity(obj);
  return entity._getDecoder('der').tree;
};

// Utility methods

function derDecodeTag(buf, fail) {
  var tag = buf.readUInt8(fail);
  if (buf.isError(tag))
    return tag;

  var cls = der.tagClass[tag >> 6];
  var primitive = (tag & 0x20) === 0;

  // Multi-octet tag - load
  if ((tag & 0x1f) === 0x1f) {
    var oct = tag;
    tag = 0;
    while ((oct & 0x80) === 0x80) {
      oct = buf.readUInt8(fail);
      if (buf.isError(oct))
        return oct;

      tag <<= 7;
      tag |= oct & 0x7f;
    }
  } else {
    tag &= 0x1f;
  }
  var tagStr = der.tag[tag];

  return {
    cls: cls,
    primitive: primitive,
    tag: tag,
    tagStr: tagStr
  };
}

function derDecodeLen(buf, primitive, fail) {
  var len = buf.readUInt8(fail);
  if (buf.isError(len))
    return len;

  // Indefinite form
  if (!primitive && len === 0x80)
    return null;

  // Definite form
  if ((len & 0x80) === 0) {
    // Short form
    return len;
  }

  // Long form
  var num = len & 0x7f;
  if (num >= 4)
    return buf.error('length octect is too long');

  len = 0;
  for (var i = 0; i < num; i++) {
    len <<= 8;
    var j = buf.readUInt8(fail);
    if (buf.isError(j))
      return j;
    len |= j;
  }

  return len;
}

},{"../../asn1":55,"inherits":143}],64:[function(require,module,exports){
var decoders = exports;

decoders.der = require('./der');

},{"./der":63}],65:[function(require,module,exports){
var inherits = require('inherits');
var Buffer = require('buffer').Buffer;

var asn1 = require('../../asn1');
var base = asn1.base;
var bignum = asn1.bignum;

// Import DER constants
var der = asn1.constants.der;

function DEREncoder(entity) {
  this.enc = 'der';
  this.name = entity.name;
  this.entity = entity;

  // Construct base tree
  this.tree = new DERNode();
  this.tree._init(entity.body);
};
module.exports = DEREncoder;

DEREncoder.prototype.encode = function encode(data, reporter) {
  return this.tree._encode(data, reporter).join();
};

// Tree methods

function DERNode(parent) {
  base.Node.call(this, 'der', parent);
}
inherits(DERNode, base.Node);

DERNode.prototype._encodeComposite = function encodeComposite(tag,
                                                              primitive,
                                                              cls,
                                                              content) {
  var encodedTag = encodeTag(tag, primitive, cls, this.reporter);

  // Short form
  if (content.length < 0x80) {
    var header = new Buffer(2);
    header[0] = encodedTag;
    header[1] = content.length;
    return this._createEncoderBuffer([ header, content ]);
  }

  // Long form
  // Count octets required to store length
  var lenOctets = 1;
  for (var i = content.length; i >= 0x100; i >>= 8)
    lenOctets++;

  var header = new Buffer(1 + 1 + lenOctets);
  header[0] = encodedTag;
  header[1] = 0x80 | lenOctets;

  for (var i = 1 + lenOctets, j = content.length; j > 0; i--, j >>= 8)
    header[i] = j & 0xff;

  return this._createEncoderBuffer([ header, content ]);
};

DERNode.prototype._encodeStr = function encodeStr(str, tag) {
  if (tag === 'octstr')
    return this._createEncoderBuffer(str);
  else if (tag === 'bitstr')
    return this._createEncoderBuffer([ str.unused | 0, str.data ]);
  else if (tag === 'ia5str')
    return this._createEncoderBuffer(str);
  return this.reporter.error('Encoding of string type: ' + tag +
                             ' unsupported');
};

DERNode.prototype._encodeObjid = function encodeObjid(id, values, relative) {
  if (typeof id === 'string') {
    if (!values)
      return this.reporter.error('string objid given, but no values map found');
    if (!values.hasOwnProperty(id))
      return this.reporter.error('objid not found in values map');
    id = values[id].split(/\s+/g);
    for (var i = 0; i < id.length; i++)
      id[i] |= 0;
  } else if (Array.isArray(id)) {
    id = id.slice();
  }

  if (!Array.isArray(id)) {
    return this.reporter.error('objid() should be either array or string, ' +
                               'got: ' + JSON.stringify(id));
  }

  if (!relative) {
    if (id[1] >= 40)
      return this.reporter.error('Second objid identifier OOB');
    id.splice(0, 2, id[0] * 40 + id[1]);
  }

  // Count number of octets
  var size = 0;
  for (var i = 0; i < id.length; i++) {
    var ident = id[i];
    for (size++; ident >= 0x80; ident >>= 7)
      size++;
  }

  var objid = new Buffer(size);
  var offset = objid.length - 1;
  for (var i = id.length - 1; i >= 0; i--) {
    var ident = id[i];
    objid[offset--] = ident & 0x7f;
    while ((ident >>= 7) > 0)
      objid[offset--] = 0x80 | (ident & 0x7f);
  }

  return this._createEncoderBuffer(objid);
};

function two(num) {
  if (num <= 10)
    return '0' + num;
  else
    return num;
}

DERNode.prototype._encodeTime = function encodeTime(time, tag) {
  var str;
  var date = new Date(time);

  if (tag === 'gentime') {
    str = [
      date.getFullYear(),
      two(date.getUTCMonth() + 1),
      two(date.getUTCDate()),
      two(date.getUTCHours()),
      two(date.getUTCMinutes()),
      two(date.getUTCSeconds()),
      'Z'
    ].join('');
  } else if (tag === 'utctime') {
    str = [
      date.getFullYear() % 100,
      two(date.getUTCMonth() + 1),
      two(date.getUTCDate()),
      two(date.getUTCHours()),
      two(date.getUTCMinutes()),
      two(date.getUTCSeconds()),
      'Z'
    ].join('');
  } else {
    this.reporter.error('Encoding ' + tag + ' time is not supported yet');
  }

  return this._encodeStr(str, 'octstr');
};

DERNode.prototype._encodeNull = function encodeNull() {
  return this._createEncoderBuffer('');
};

DERNode.prototype._encodeInt = function encodeInt(num, values) {
  if (typeof num === 'string') {
    if (!values)
      return this.reporter.error('String int or enum given, but no values map');
    if (!values.hasOwnProperty(num)) {
      return this.reporter.error('Values map doesn\'t contain: ' +
                                 JSON.stringify(num));
    }
    num = values[num];
  }

  // Bignum, assume big endian
  if (bignum !== null && num instanceof bignum) {
    var numArray = num.toArray();
    if(num.sign === false && numArray[0] & 0x80) {
      numArray.unshift(0);
    }
    num = new Buffer(numArray);
  }

  if (Buffer.isBuffer(num)) {
    var size = num.length;
    if (num.length === 0)
      size++;

    var out = new Buffer(size);
    num.copy(out);
    if (num.length === 0)
      out[0] = 0
    return this._createEncoderBuffer(out);
  }

  if (num < 0x80)
    return this._createEncoderBuffer(num);

  if (num < 0x100)
    return this._createEncoderBuffer([0, num]);

  var size = 1;
  for (var i = num; i >= 0x100; i >>= 8)
    size++;

  var out = new Array(size);
  for (var i = out.length - 1; i >= 0; i--) {
    out[i] = num & 0xff;
    num >>= 8;
  }
  if(out[0] & 0x80) {
    out.unshift(0);
  }

  return this._createEncoderBuffer(new Buffer(out));
};

DERNode.prototype._encodeBool = function encodeBool(value) {
  return this._createEncoderBuffer(value ? 0xff : 0);
};

DERNode.prototype._use = function use(entity, obj) {
  if (typeof entity === 'function')
    entity = entity(obj);
  return entity._getEncoder('der').tree;
};

DERNode.prototype._skipDefault = function skipDefault(dataBuffer, reporter, parent) {
  var state = this._baseState;
  var i;
  if (state['default'] === null)
    return false;

  var data = dataBuffer.join();
  if (state.defaultBuffer === undefined)
    state.defaultBuffer = this._encodeValue(state['default'], reporter, parent).join();

  if (data.length !== state.defaultBuffer.length)
    return false;

  for (i=0; i < data.length; i++)
    if (data[i] !== state.defaultBuffer[i])
      return false;

  return true;
};

// Utility methods

function encodeTag(tag, primitive, cls, reporter) {
  var res;

  if (tag === 'seqof')
    tag = 'seq';
  else if (tag === 'setof')
    tag = 'set';

  if (der.tagByName.hasOwnProperty(tag))
    res = der.tagByName[tag];
  else if (typeof tag === 'number' && (tag | 0) === tag)
    res = tag;
  else
    return reporter.error('Unknown tag: ' + tag);

  if (res >= 0x1f)
    return reporter.error('Multi-octet tag encoding unsupported');

  if (!primitive)
    res |= 0x20;

  res |= (der.tagClassByName[cls || 'universal'] << 6);

  return res;
}

},{"../../asn1":55,"buffer":"buffer","inherits":143}],66:[function(require,module,exports){
var encoders = exports;

encoders.der = require('./der');

},{"./der":65}],67:[function(require,module,exports){
module.exports = assert;

function assert(val, msg) {
  if (!val)
    throw new Error(msg || 'Assertion failed');
}

assert.equal = function assertEqual(l, r, msg) {
  if (l != r)
    throw new Error(msg || ('Assertion failed: ' + l + ' != ' + r));
};

},{}],68:[function(require,module,exports){
exports.strip = function strip(artifact) {
  artifact = artifact.toString()
  var startRegex = /^-----BEGIN (.*)-----\n/;
  var match = startRegex.exec(artifact);
  var tag = match[1];
  var endRegex = new RegExp("\n-----END " + tag + "-----(\n*)$");
  var base64 = artifact.slice(match[0].length).replace(endRegex, "").replace(/\n/g, "");
  return {tag: tag, base64: base64};
};

// http://stackoverflow.com/a/7033705
var wrap = function wrap(str, l) {
  var chunks = [];
  while (str) {
    if (str.length < l) {
      chunks.push(str);
      break;
    }
    else {
      chunks.push(str.substr(0, l));
      str = str.substr(l);
    }
  }
  return chunks.join("\n");
}

exports.assemble = function assemble(info) {
  var tag = info.tag;
  var base64 = info.base64;
  var startLine = "-----BEGIN " + tag + "-----";
  var endLine = "-----END " + tag + "-----";
  return startLine + "\n" + wrap(base64, 64) + "\n" + endLine + "\n";
}
},{}],69:[function(require,module,exports){
(function (Buffer){
// much of this based on https://github.com/indutny/self-signed/blob/gh-pages/lib/rsa.js
var parseKeys = require('parse-asn1');
var bn = require('bn.js');
var elliptic = require('elliptic');
var crt = require("browserify-rsa");
module.exports = sign;
function sign(hash, key, hashType, crypto) {
  var priv = parseKeys(key, crypto);
  if (priv.curve) {
    return ecSign(hash, priv, crypto);
  } else if (priv.type === 'dsa') {
    return dsaSign(hash, priv, hashType, crypto);
  }
  var len = priv.modulus.byteLength();
  var pad = [ 0, 1 ];
  while (hash.length + pad.length + 1 < len) {
    pad.push(0xff);
  }
  pad.push(0x00);
  var i = -1;
  while (++i < hash.length) {
    pad.push(hash[i]);
  }
  
  var out = crt(pad, priv, crypto);
  return out;
}
function ecSign(hash, priv, crypto) {
  elliptic.rand = crypto.randomBytes;
  var curve;
  if (priv.curve.join('.')  === '1.3.132.0.10') {
    curve = new elliptic.ec('secp256k1');
  }
  var key = curve.genKeyPair();
  key._importPrivate(priv.privateKey);
  var out = key.sign(hash);
  return new Buffer(out.toDER());
}
function dsaSign(hash, priv, algo, crypto) {
  var x = priv.params.priv_key;
  var p = priv.params.p;
  var q = priv.params.q;
  var montq = bn.mont(q);
  var g = priv.params.g;
  var r = new bn(0);
  var k;
  var H = bits2int(hash, q).mod(q);
  var s = false;
  var kv = getKay(x, q, hash, algo, crypto);
  while (s === false) {
    k = makeKey(q, kv, algo, crypto);
    r = makeR(g, k, p, q);
    s = k.invm(q).imul(H.add(x.mul(r))).mod(q);
    if (!s.cmpn(0)) {
      s = false;
      r = new bn(0);
    }
  }
  return toDER(r,s);
}
function toDER(r, s) {
  r = r.toArray();
  s = s.toArray();

  // Pad values
  if (r[0] & 0x80)
    r = [ 0 ].concat(r);
  // Pad values
  if (s[0] & 0x80)
    s = [0].concat(s);

  var total = r.length + s.length + 4;
  var res = [ 0x30, total, 0x02, r.length ];
  res = res.concat(r, [ 0x02, s.length ], s);
  return new Buffer(res);
}
module.exports.getKay = getKay;
function getKay(x, q, hash, algo, crypto) {
  x = new Buffer(x.toArray());
  if (x.length < q.byteLength()) {
    var zeros = new Buffer(q.byteLength() - x.length);
    zeros.fill(0);
    x = Buffer.concat([zeros, x]);
  }
  var hlen = hash.length;
  var hbits = bits2octets(hash, q);
  var v = new Buffer(hlen);
  v.fill(1);
  var k = new Buffer(hlen);
  k.fill(0);
  k = crypto.createHmac(algo, k)
    .update(v)
    .update(new Buffer([0]))
    .update(x)
    .update(hbits)
    .digest();
  v = crypto.createHmac(algo, k)
    .update(v)
    .digest();
  k = crypto.createHmac(algo, k)
    .update(v)
    .update(new Buffer([1]))
    .update(x)
    .update(hbits)
    .digest();
  v = crypto.createHmac(algo, k)
    .update(v)
    .digest();
  return {
    k:k,
    v:v
  };
}
function bits2int(obits, q) {
  bits = new bn(obits);
  var shift = obits.length * 8 - q.bitLength();
  if (shift > 0) {
    bits.ishrn(shift);
  }
  return bits;
}
function bits2octets (bits, q) {
  bits = bits2int(bits, q);
  bits = bits.mod(q);
  var out = new Buffer(bits.toArray());
  if (out.length < q.byteLength()) {
    var zeros = new Buffer(q.byteLength() - out.length);
    zeros.fill(0);
    out = Buffer.concat([zeros, out]);
  }
  return out;
}
module.exports.makeKey = makeKey;
function makeKey(q, kv, algo, crypto) {
  var t;
  var k;
  while (true) {
    t = new Buffer('');
    while (t.length * 8 < q.bitLength()) {
      kv.v = crypto.createHmac(algo, kv.k)
        .update(kv.v)
        .digest();
      t = Buffer.concat([t, kv.v]);
    }
    k = bits2int(t, q);
    kv.k =  crypto.createHmac(algo, kv.k)
        .update(kv.v)
        .update(new Buffer([0]))
        .digest();
    kv.v = crypto.createHmac(algo, kv.k)
        .update(kv.v)
        .digest();
    if (k.cmp(q) === -1) {
      return k;
    }
  }
}
function makeR(g, k, p, q) {
  return g.toRed(bn.mont(p)).redPow(k).fromRed().mod(q);
}
}).call(this,require("buffer").Buffer)
},{"bn.js":27,"browserify-rsa":28,"buffer":"buffer","elliptic":29,"parse-asn1":53}],70:[function(require,module,exports){
(function (Buffer){
// much of this based on https://github.com/indutny/self-signed/blob/gh-pages/lib/rsa.js
var parseKeys = require('parse-asn1');
var elliptic = require('elliptic');
var bn = require('bn.js');
module.exports = verify;
function verify(sig, hash, key) {
  var pub = parseKeys(key);
  if (pub.type === 'ec') {
    return ecVerify(sig, hash, pub);
  } else if (pub.type === 'dsa') {
    return dsaVerify(sig, hash, pub);
  }
  var len = pub.modulus.byteLength();
  var pad = [ 0, 1 ];
  while (hash.length + pad.length + 1 < len) {
    pad.push(0xff);
  }
  pad.push(0x00);
  var i = -1;
  while (++i < hash.length) {
    pad.push(hash[i]);
  }
  pad = hash;
  var red = bn.mont(pub.modulus);
  sig = new bn(sig).toRed(red);

  sig = sig.redPow(new bn(pub.publicExponent));

  sig = new Buffer(sig.fromRed().toArray());
  sig = sig.slice(sig.length - hash.length);
  var out = 0;
  len = sig.length;
  i = -1;
  while (++i < len) {
    out += (sig[i] ^ hash[i]);
  }
  return !out;
}
function ecVerify(sig, hash, pub) {
  var curve;
  if (pub.data.algorithm.curve.join('.')  === '1.3.132.0.10') {
    curve = new elliptic.ec('secp256k1');
  }
  var pubkey = pub.data.subjectPrivateKey.data;
  return curve.verify(hash.toString('hex'), sig.toString('hex'), pubkey.toString('hex'));
}
function dsaVerify(sig, hash, pub) {
  var p = pub.data.p;
  var q = pub.data.q;
  var g = pub.data.g;
  var y = pub.data.pub_key;
  var unpacked = parseKeys.signature.decode(sig, 'der');
  var s = unpacked.s;
  var r = unpacked.r;
  checkValue(s, q);
  checkValue(r, q);
  var montq = bn.mont(q);
  var montp = bn.mont(p);
  var w =  s.invm(q);
  var v = g.toRed(montp)
  .redPow(new bn(hash).mul(w).mod(q))
  .fromRed()
  .mul(
    y.toRed(montp)
    .redPow(r.mul(w).mod(q))
    .fromRed()
  ).mod(p).mod(q);
  return !v.cmp(r);
}
function checkValue(b, q) {
  if (b.cmpn(0) <= 0) {
    throw new Error('invalid sig');
  }
  if (b.cmp(q) >= q) {
    throw new Error('invalid sig');
  }
}
}).call(this,require("buffer").Buffer)
},{"bn.js":27,"buffer":"buffer","elliptic":29,"parse-asn1":53}],71:[function(require,module,exports){
(function (Buffer){
var elliptic = require('elliptic');
var BN = require('bn.js');
module.exports = ECDH;

function ECDH(curve, crypto) {
	elliptic.rand = crypto.randomBytes;
	this.curve = new elliptic.ec(curve);
	this.keys = void 0;
}
ECDH.prototype.generateKeys = function (enc, format) {
	this.keys = this.curve.genKeyPair();
	return this.getPublicKey(enc, format);
};

ECDH.prototype.computeSecret = function (other, inenc, enc) {
	inenc = inenc || 'utf8';
	if (!Buffer.isBuffer(other)) {
		other = new Buffer(other, inenc);
	}
	other = new BN(other);
	other = other.toString(16);
	var otherPub = this.curve.keyPair(other, 'hex').getPublic();
	var out = otherPub.mul(this.keys.getPrivate()).getX();
	return returnValue(out, enc);
};
ECDH.prototype.getPublicKey = function (enc, format) {
	var key = this.keys.getPublic(format === 'compressed', true);
	if (format === 'hybrid') {
		if (key[key.length - 1] % 2) {
			key[0] = 7;
		} else {
			key [0] = 6;
		}
	}
	return returnValue(key, enc);
};
ECDH.prototype.getPrivateKey = function (enc) {
	return returnValue(this.keys.getPrivate(), enc);
};

ECDH.prototype.setPublicKey = function (pub, enc) {
	enc = enc || 'utf8';
	if (!Buffer.isBuffer(pub)) {
		pub = new Buffer(pub, enc);
	}
	var pkey = new BN(pub);
	pkey = pkey.toArray();
	this.keys._importPublicHex(pkey);
};
ECDH.prototype.setPrivateKey = function (priv, enc) {
	enc = enc || 'utf8';
	if (!Buffer.isBuffer(priv)) {
		priv = new Buffer(priv, enc);
	}
	var _priv = new BN(priv);
	_priv = _priv.toString(16);
	this.keys._importPrivate(_priv);
};
function returnValue(bn, enc) {
	if (!Array.isArray(bn)) {
		bn = bn.toArray();
	}
	var buf = new Buffer(bn);
	if (!enc) {
		return buf;
	} else {
		return buf.toString(enc);
	}
}
}).call(this,require("buffer").Buffer)
},{"bn.js":73,"buffer":"buffer","elliptic":74}],72:[function(require,module,exports){
var ECDH = require('./ecdh');
module.exports = function (crypto, exports) {
	exports.createECDH = function (curve) {
		return new ECDH(curve, crypto);
	};
};
},{"./ecdh":71}],73:[function(require,module,exports){
arguments[4][27][0].apply(exports,arguments)
},{"dup":27}],74:[function(require,module,exports){
arguments[4][29][0].apply(exports,arguments)
},{"../package.json":93,"./elliptic/curve":77,"./elliptic/curves":80,"./elliptic/ec":81,"./elliptic/hmac-drbg":84,"./elliptic/utils":85,"brorand":86,"dup":29}],75:[function(require,module,exports){
arguments[4][30][0].apply(exports,arguments)
},{"../../elliptic":74,"bn.js":73,"dup":30}],76:[function(require,module,exports){
arguments[4][31][0].apply(exports,arguments)
},{"../../elliptic":74,"../curve":77,"bn.js":73,"dup":31,"inherits":143}],77:[function(require,module,exports){
arguments[4][32][0].apply(exports,arguments)
},{"./base":75,"./edwards":76,"./mont":78,"./short":79,"dup":32}],78:[function(require,module,exports){
arguments[4][33][0].apply(exports,arguments)
},{"../../elliptic":74,"../curve":77,"bn.js":73,"dup":33,"inherits":143}],79:[function(require,module,exports){
arguments[4][34][0].apply(exports,arguments)
},{"../../elliptic":74,"../curve":77,"bn.js":73,"dup":34,"inherits":143}],80:[function(require,module,exports){
arguments[4][35][0].apply(exports,arguments)
},{"../elliptic":74,"bn.js":73,"dup":35,"hash.js":87}],81:[function(require,module,exports){
arguments[4][36][0].apply(exports,arguments)
},{"../../elliptic":74,"./key":82,"./signature":83,"bn.js":73,"dup":36}],82:[function(require,module,exports){
arguments[4][37][0].apply(exports,arguments)
},{"../../elliptic":74,"bn.js":73,"dup":37}],83:[function(require,module,exports){
arguments[4][38][0].apply(exports,arguments)
},{"../../elliptic":74,"bn.js":73,"dup":38}],84:[function(require,module,exports){
arguments[4][39][0].apply(exports,arguments)
},{"../elliptic":74,"dup":39,"hash.js":87}],85:[function(require,module,exports){
arguments[4][40][0].apply(exports,arguments)
},{"bn.js":73,"dup":40}],86:[function(require,module,exports){
arguments[4][41][0].apply(exports,arguments)
},{"dup":41}],87:[function(require,module,exports){
arguments[4][42][0].apply(exports,arguments)
},{"./hash/common":88,"./hash/hmac":89,"./hash/ripemd":90,"./hash/sha":91,"./hash/utils":92,"dup":42}],88:[function(require,module,exports){
arguments[4][43][0].apply(exports,arguments)
},{"../hash":87,"dup":43}],89:[function(require,module,exports){
arguments[4][44][0].apply(exports,arguments)
},{"../hash":87,"dup":44}],90:[function(require,module,exports){
arguments[4][45][0].apply(exports,arguments)
},{"../hash":87,"dup":45}],91:[function(require,module,exports){
arguments[4][46][0].apply(exports,arguments)
},{"../hash":87,"dup":46}],92:[function(require,module,exports){
arguments[4][47][0].apply(exports,arguments)
},{"dup":47,"inherits":143}],93:[function(require,module,exports){
arguments[4][48][0].apply(exports,arguments)
},{"dup":48}],94:[function(require,module,exports){
(function (Buffer){
'use strict';
var createHash = require('sha.js')

var md5 = require('./md5')
var rmd160 = require('ripemd160')
var Transform = require('stream').Transform;
var inherits = require('inherits')

module.exports = function (alg) {
  if('md5' === alg) return new HashNoConstructor(md5)
  if('rmd160' === alg) return new HashNoConstructor(rmd160)
  return new Hash(createHash(alg))
}
inherits(HashNoConstructor, Transform)

function HashNoConstructor(hash) {
  Transform.call(this);
  this._hash = hash
  this.buffers = []
}

HashNoConstructor.prototype._transform = function (data, _, done) {
  this.buffers.push(data)
  done()
}
HashNoConstructor.prototype._flush = function (done) {
  var buf = Buffer.concat(this.buffers)
  var r = this._hash(buf)
  this.buffers = null
  this.push(r)
  done()
}
HashNoConstructor.prototype.update = function (data, enc) {
  this.write(data, enc)
  return this
}

HashNoConstructor.prototype.digest = function (enc) {
  this.end()
  var outData = new Buffer('')
  var chunk
  while ((chunk = this.read())) {
    outData = Buffer.concat([outData, chunk])
  }
  if (enc) {
    outData = outData.toString(enc)
  }
  return outData
}

inherits(Hash, Transform)

function Hash(hash) {
  Transform.call(this);
  this._hash = hash
}

Hash.prototype._transform = function (data, _, done) {
  this._hash.update(data)
  done()
}
Hash.prototype._flush = function (done) {
  this.push(this._hash.digest())
  this._hash = null
  done()
}
Hash.prototype.update = function (data, enc) {
  this.write(data, enc)
  return this
}

Hash.prototype.digest = function (enc) {
  this.end()
  var outData = new Buffer('')
  var chunk
  while ((chunk = this.read())) {
    outData = Buffer.concat([outData, chunk])
  }
  if (enc) {
    outData = outData.toString(enc)
  }
  return outData
}
}).call(this,require("buffer").Buffer)
},{"./md5":96,"buffer":"buffer","inherits":143,"ripemd160":97,"sha.js":99,"stream":159}],95:[function(require,module,exports){
(function (Buffer){
'use strict';
var intSize = 4;
var zeroBuffer = new Buffer(intSize); zeroBuffer.fill(0);
var chrsz = 8;

function toArray(buf, bigEndian) {
  if ((buf.length % intSize) !== 0) {
    var len = buf.length + (intSize - (buf.length % intSize));
    buf = Buffer.concat([buf, zeroBuffer], len);
  }

  var arr = [];
  var fn = bigEndian ? buf.readInt32BE : buf.readInt32LE;
  for (var i = 0; i < buf.length; i += intSize) {
    arr.push(fn.call(buf, i));
  }
  return arr;
}

function toBuffer(arr, size, bigEndian) {
  var buf = new Buffer(size);
  var fn = bigEndian ? buf.writeInt32BE : buf.writeInt32LE;
  for (var i = 0; i < arr.length; i++) {
    fn.call(buf, arr[i], i * 4, true);
  }
  return buf;
}

function hash(buf, fn, hashSize, bigEndian) {
  if (!Buffer.isBuffer(buf)) buf = new Buffer(buf);
  var arr = fn(toArray(buf, bigEndian), buf.length * chrsz);
  return toBuffer(arr, hashSize, bigEndian);
}
exports.hash = hash;
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],96:[function(require,module,exports){
'use strict';
/*
 * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
 * Digest Algorithm, as defined in RFC 1321.
 * Version 2.1 Copyright (C) Paul Johnston 1999 - 2002.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for more info.
 */

var helpers = require('./helpers');

/*
 * Calculate the MD5 of an array of little-endian words, and a bit length
 */
function core_md5(x, len)
{
  /* append padding */
  x[len >> 5] |= 0x80 << ((len) % 32);
  x[(((len + 64) >>> 9) << 4) + 14] = len;

  var a =  1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d =  271733878;

  for(var i = 0; i < x.length; i += 16)
  {
    var olda = a;
    var oldb = b;
    var oldc = c;
    var oldd = d;

    a = md5_ff(a, b, c, d, x[i+ 0], 7 , -680876936);
    d = md5_ff(d, a, b, c, x[i+ 1], 12, -389564586);
    c = md5_ff(c, d, a, b, x[i+ 2], 17,  606105819);
    b = md5_ff(b, c, d, a, x[i+ 3], 22, -1044525330);
    a = md5_ff(a, b, c, d, x[i+ 4], 7 , -176418897);
    d = md5_ff(d, a, b, c, x[i+ 5], 12,  1200080426);
    c = md5_ff(c, d, a, b, x[i+ 6], 17, -1473231341);
    b = md5_ff(b, c, d, a, x[i+ 7], 22, -45705983);
    a = md5_ff(a, b, c, d, x[i+ 8], 7 ,  1770035416);
    d = md5_ff(d, a, b, c, x[i+ 9], 12, -1958414417);
    c = md5_ff(c, d, a, b, x[i+10], 17, -42063);
    b = md5_ff(b, c, d, a, x[i+11], 22, -1990404162);
    a = md5_ff(a, b, c, d, x[i+12], 7 ,  1804603682);
    d = md5_ff(d, a, b, c, x[i+13], 12, -40341101);
    c = md5_ff(c, d, a, b, x[i+14], 17, -1502002290);
    b = md5_ff(b, c, d, a, x[i+15], 22,  1236535329);

    a = md5_gg(a, b, c, d, x[i+ 1], 5 , -165796510);
    d = md5_gg(d, a, b, c, x[i+ 6], 9 , -1069501632);
    c = md5_gg(c, d, a, b, x[i+11], 14,  643717713);
    b = md5_gg(b, c, d, a, x[i+ 0], 20, -373897302);
    a = md5_gg(a, b, c, d, x[i+ 5], 5 , -701558691);
    d = md5_gg(d, a, b, c, x[i+10], 9 ,  38016083);
    c = md5_gg(c, d, a, b, x[i+15], 14, -660478335);
    b = md5_gg(b, c, d, a, x[i+ 4], 20, -405537848);
    a = md5_gg(a, b, c, d, x[i+ 9], 5 ,  568446438);
    d = md5_gg(d, a, b, c, x[i+14], 9 , -1019803690);
    c = md5_gg(c, d, a, b, x[i+ 3], 14, -187363961);
    b = md5_gg(b, c, d, a, x[i+ 8], 20,  1163531501);
    a = md5_gg(a, b, c, d, x[i+13], 5 , -1444681467);
    d = md5_gg(d, a, b, c, x[i+ 2], 9 , -51403784);
    c = md5_gg(c, d, a, b, x[i+ 7], 14,  1735328473);
    b = md5_gg(b, c, d, a, x[i+12], 20, -1926607734);

    a = md5_hh(a, b, c, d, x[i+ 5], 4 , -378558);
    d = md5_hh(d, a, b, c, x[i+ 8], 11, -2022574463);
    c = md5_hh(c, d, a, b, x[i+11], 16,  1839030562);
    b = md5_hh(b, c, d, a, x[i+14], 23, -35309556);
    a = md5_hh(a, b, c, d, x[i+ 1], 4 , -1530992060);
    d = md5_hh(d, a, b, c, x[i+ 4], 11,  1272893353);
    c = md5_hh(c, d, a, b, x[i+ 7], 16, -155497632);
    b = md5_hh(b, c, d, a, x[i+10], 23, -1094730640);
    a = md5_hh(a, b, c, d, x[i+13], 4 ,  681279174);
    d = md5_hh(d, a, b, c, x[i+ 0], 11, -358537222);
    c = md5_hh(c, d, a, b, x[i+ 3], 16, -722521979);
    b = md5_hh(b, c, d, a, x[i+ 6], 23,  76029189);
    a = md5_hh(a, b, c, d, x[i+ 9], 4 , -640364487);
    d = md5_hh(d, a, b, c, x[i+12], 11, -421815835);
    c = md5_hh(c, d, a, b, x[i+15], 16,  530742520);
    b = md5_hh(b, c, d, a, x[i+ 2], 23, -995338651);

    a = md5_ii(a, b, c, d, x[i+ 0], 6 , -198630844);
    d = md5_ii(d, a, b, c, x[i+ 7], 10,  1126891415);
    c = md5_ii(c, d, a, b, x[i+14], 15, -1416354905);
    b = md5_ii(b, c, d, a, x[i+ 5], 21, -57434055);
    a = md5_ii(a, b, c, d, x[i+12], 6 ,  1700485571);
    d = md5_ii(d, a, b, c, x[i+ 3], 10, -1894986606);
    c = md5_ii(c, d, a, b, x[i+10], 15, -1051523);
    b = md5_ii(b, c, d, a, x[i+ 1], 21, -2054922799);
    a = md5_ii(a, b, c, d, x[i+ 8], 6 ,  1873313359);
    d = md5_ii(d, a, b, c, x[i+15], 10, -30611744);
    c = md5_ii(c, d, a, b, x[i+ 6], 15, -1560198380);
    b = md5_ii(b, c, d, a, x[i+13], 21,  1309151649);
    a = md5_ii(a, b, c, d, x[i+ 4], 6 , -145523070);
    d = md5_ii(d, a, b, c, x[i+11], 10, -1120210379);
    c = md5_ii(c, d, a, b, x[i+ 2], 15,  718787259);
    b = md5_ii(b, c, d, a, x[i+ 9], 21, -343485551);

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
  }
  return Array(a, b, c, d);

}

/*
 * These functions implement the four basic operations the algorithm uses.
 */
function md5_cmn(q, a, b, x, s, t)
{
  return safe_add(bit_rol(safe_add(safe_add(a, q), safe_add(x, t)), s),b);
}
function md5_ff(a, b, c, d, x, s, t)
{
  return md5_cmn((b & c) | ((~b) & d), a, b, x, s, t);
}
function md5_gg(a, b, c, d, x, s, t)
{
  return md5_cmn((b & d) | (c & (~d)), a, b, x, s, t);
}
function md5_hh(a, b, c, d, x, s, t)
{
  return md5_cmn(b ^ c ^ d, a, b, x, s, t);
}
function md5_ii(a, b, c, d, x, s, t)
{
  return md5_cmn(c ^ (b | (~d)), a, b, x, s, t);
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y)
{
  var lsw = (x & 0xFFFF) + (y & 0xFFFF);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function bit_rol(num, cnt)
{
  return (num << cnt) | (num >>> (32 - cnt));
}

module.exports = function md5(buf) {
  return helpers.hash(buf, core_md5, 16);
};
},{"./helpers":95}],97:[function(require,module,exports){
(function (Buffer){
/*
CryptoJS v3.1.2
code.google.com/p/crypto-js
(c) 2009-2013 by Jeff Mott. All rights reserved.
code.google.com/p/crypto-js/wiki/License
*/
/** @preserve
(c) 2012 by Cédric Mesnil. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

    - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
    - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

// constants table
var zl = [
    0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
    7,  4, 13,  1, 10,  6, 15,  3, 12,  0,  9,  5,  2, 14, 11,  8,
    3, 10, 14,  4,  9, 15,  8,  1,  2,  7,  0,  6, 13, 11,  5, 12,
    1,  9, 11, 10,  0,  8, 12,  4, 13,  3,  7, 15, 14,  5,  6,  2,
    4,  0,  5,  9,  7, 12,  2, 10, 14,  1,  3,  8, 11,  6, 15, 13]

var zr = [
    5, 14,  7,  0,  9,  2, 11,  4, 13,  6, 15,  8,  1, 10,  3, 12,
    6, 11,  3,  7,  0, 13,  5, 10, 14, 15,  8, 12,  4,  9,  1,  2,
    15,  5,  1,  3,  7, 14,  6,  9, 11,  8, 12,  2, 10,  0,  4, 13,
    8,  6,  4,  1,  3, 11, 15,  0,  5, 12,  2, 13,  9,  7, 10, 14,
    12, 15, 10,  4,  1,  5,  8,  7,  6,  2, 13, 14,  0,  3,  9, 11]

var sl = [
     11, 14, 15, 12,  5,  8,  7,  9, 11, 13, 14, 15,  6,  7,  9,  8,
    7, 6,   8, 13, 11,  9,  7, 15,  7, 12, 15,  9, 11,  7, 13, 12,
    11, 13,  6,  7, 14,  9, 13, 15, 14,  8, 13,  6,  5, 12,  7,  5,
      11, 12, 14, 15, 14, 15,  9,  8,  9, 14,  5,  6,  8,  6,  5, 12,
    9, 15,  5, 11,  6,  8, 13, 12,  5, 12, 13, 14, 11,  8,  5,  6 ]

var sr = [
    8,  9,  9, 11, 13, 15, 15,  5,  7,  7,  8, 11, 14, 14, 12,  6,
    9, 13, 15,  7, 12,  8,  9, 11,  7,  7, 12,  7,  6, 15, 13, 11,
    9,  7, 15, 11,  8,  6,  6, 14, 12, 13,  5, 14, 13, 13,  7,  5,
    15,  5,  8, 11, 14, 14,  6, 14,  6,  9, 12,  9, 12,  5, 15,  8,
    8,  5, 12,  9, 12,  5, 14,  6,  8, 13,  6,  5, 15, 13, 11, 11 ]


var hl =  [0x00000000, 0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xA953FD4E]
var hr =  [0x50A28BE6, 0x5C4DD124, 0x6D703EF3, 0x7A6D76E9, 0x00000000]

function bytesToWords(bytes) {
  var words = []
  for (var i = 0, b = 0; i < bytes.length; i++, b += 8) {
    words[b >>> 5] |= bytes[i] << (24 - b % 32)
  }
  return words
}

function wordsToBytes(words) {
  var bytes = []
  for (var b = 0; b < words.length * 32; b += 8) {
    bytes.push((words[b >>> 5] >>> (24 - b % 32)) & 0xFF)
  }
  return bytes
}

function processBlock(H, M, offset) {
  // swap endian
  for (var i = 0; i < 16; i++) {
    var offset_i = offset + i;
    var M_offset_i = M[offset_i]

    // Swap
    M[offset_i] = (
        (((M_offset_i << 8)  | (M_offset_i >>> 24)) & 0x00ff00ff) |
        (((M_offset_i << 24) | (M_offset_i >>> 8))  & 0xff00ff00)
    )
  }

  // Working variables
  var al, bl, cl, dl, el
  var ar, br, cr, dr, er

  ar = al = H[0]
  br = bl = H[1]
  cr = cl = H[2]
  dr = dl = H[3]
  er = el = H[4]

  // computation
  var t
  for (var i = 0; i < 80; i += 1) {
    t = (al +  M[offset+zl[i]])|0
    if (i<16){
        t +=  f1(bl,cl,dl) + hl[0]
    } else if (i<32) {
        t +=  f2(bl,cl,dl) + hl[1]
    } else if (i<48) {
        t +=  f3(bl,cl,dl) + hl[2]
    } else if (i<64) {
        t +=  f4(bl,cl,dl) + hl[3]
    } else {// if (i<80) {
        t +=  f5(bl,cl,dl) + hl[4]
    }
    t = t|0
    t =  rotl(t,sl[i])
    t = (t+el)|0
    al = el
    el = dl
    dl = rotl(cl, 10)
    cl = bl
    bl = t

    t = (ar + M[offset+zr[i]])|0
    if (i<16) {
      t +=  f5(br,cr,dr) + hr[0]
    } else if (i<32) {
      t +=  f4(br,cr,dr) + hr[1]
    } else if (i<48) {
      t +=  f3(br,cr,dr) + hr[2]
    } else if (i<64) {
      t +=  f2(br,cr,dr) + hr[3]
    } else {// if (i<80) {
      t +=  f1(br,cr,dr) + hr[4]
    }

    t = t|0
    t =  rotl(t,sr[i]) 
    t = (t+er)|0
    ar = er
    er = dr
    dr = rotl(cr, 10)
    cr = br
    br = t
  }

  // intermediate hash value
  t    = (H[1] + cl + dr)|0
  H[1] = (H[2] + dl + er)|0
  H[2] = (H[3] + el + ar)|0
  H[3] = (H[4] + al + br)|0
  H[4] = (H[0] + bl + cr)|0
  H[0] =  t
}

function f1(x, y, z) {
  return ((x) ^ (y) ^ (z))
}

function f2(x, y, z) {
  return (((x)&(y)) | ((~x)&(z)))
}

function f3(x, y, z) {
  return (((x) | (~(y))) ^ (z))
}

function f4(x, y, z) {
  return (((x) & (z)) | ((y)&(~(z))))
}

function f5(x, y, z) {
  return ((x) ^ ((y) |(~(z))))
}

function rotl(x,n) {
  return (x<<n) | (x>>>(32-n))
}

function ripemd160(message) {
  var H = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]

  if (typeof message == 'string')
    message = new Buffer(message, 'utf8')

  var m = bytesToWords(message)

  var nBitsLeft = message.length * 8
  var nBitsTotal = message.length * 8

  // Add padding
  m[nBitsLeft >>> 5] |= 0x80 << (24 - nBitsLeft % 32)
  m[(((nBitsLeft + 64) >>> 9) << 4) + 14] = (
      (((nBitsTotal << 8)  | (nBitsTotal >>> 24)) & 0x00ff00ff) |
      (((nBitsTotal << 24) | (nBitsTotal >>> 8))  & 0xff00ff00)
  )

  for (var i=0 ; i<m.length; i += 16) {
    processBlock(H, m, i)
  }

  // swap endian
  for (var i = 0; i < 5; i++) {
      // shortcut
    var H_i = H[i]

    // Swap
    H[i] = (((H_i << 8)  | (H_i >>> 24)) & 0x00ff00ff) |
          (((H_i << 24) | (H_i >>> 8))  & 0xff00ff00)
  }

  var digestbytes = wordsToBytes(H)
  return new Buffer(digestbytes)
}

module.exports = ripemd160

}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],98:[function(require,module,exports){
(function (Buffer){
//prototype class for hash functions
function Hash (blockSize, finalSize) {
  this._block = new Buffer(blockSize) //new Uint32Array(blockSize/4)
  this._finalSize = finalSize
  this._blockSize = blockSize
  this._len = 0
  this._s = 0
}

Hash.prototype.update = function (data, enc) {
  if ("string" === typeof data) {
    enc = enc || "utf8"
    data = new Buffer(data, enc)
  }

  var l = this._len += data.length
  var s = this._s || 0
  var f = 0
  var buffer = this._block

  while (s < l) {
    var t = Math.min(data.length, f + this._blockSize - (s % this._blockSize))
    var ch = (t - f)

    for (var i = 0; i < ch; i++) {
      buffer[(s % this._blockSize) + i] = data[i + f]
    }

    s += ch
    f += ch

    if ((s % this._blockSize) === 0) {
      this._update(buffer)
    }
  }
  this._s = s

  return this
}

Hash.prototype.digest = function (enc) {
  // Suppose the length of the message M, in bits, is l
  var l = this._len * 8

  // Append the bit 1 to the end of the message
  this._block[this._len % this._blockSize] = 0x80

  // and then k zero bits, where k is the smallest non-negative solution to the equation (l + 1 + k) === finalSize mod blockSize
  this._block.fill(0, this._len % this._blockSize + 1)

  if (l % (this._blockSize * 8) >= this._finalSize * 8) {
    this._update(this._block)
    this._block.fill(0)
  }

  // to this append the block which is equal to the number l written in binary
  // TODO: handle case where l is > Math.pow(2, 29)
  this._block.writeInt32BE(l, this._blockSize - 4)

  var hash = this._update(this._block) || this._hash()

  return enc ? hash.toString(enc) : hash
}

Hash.prototype._update = function () {
  throw new Error('_update must be implemented by subclass')
}

module.exports = Hash

}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],99:[function(require,module,exports){
var exports = module.exports = function (alg) {
  var Alg = exports[alg.toLowerCase()]
  if(!Alg) throw new Error(alg + ' is not supported (we accept pull requests)')
  return new Alg()
}


exports.sha1 = require('./sha1')
exports.sha224 = require('./sha224')
exports.sha256 = require('./sha256')
exports.sha384 = require('./sha384')
exports.sha512 = require('./sha512')

},{"./sha1":100,"./sha224":101,"./sha256":102,"./sha384":103,"./sha512":104}],100:[function(require,module,exports){
(function (Buffer){
/*
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-1, as defined
 * in FIPS PUB 180-1
 * Version 2.1a Copyright Paul Johnston 2000 - 2002.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for details.
 */

var inherits = require('inherits')
var Hash = require('./hash')

var W = new Array(80)

function Sha1() {
  this.init()
  this._w = W

  Hash.call(this, 64, 56)
}

inherits(Sha1, Hash)

Sha1.prototype.init = function () {
  this._a = 0x67452301
  this._b = 0xefcdab89
  this._c = 0x98badcfe
  this._d = 0x10325476
  this._e = 0xc3d2e1f0

  return this
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function rol(num, cnt) {
  return (num << cnt) | (num >>> (32 - cnt));
}

Sha1.prototype._update = function (M) {
  var W = this._w

  var a = this._a
  var b = this._b
  var c = this._c
  var d = this._d
  var e = this._e

  var j = 0, k

  function calcW() { return rol(W[j - 3] ^ W[j -  8] ^ W[j - 14] ^ W[j - 16], 1) }
  function loop(w, f) {
    W[j] = w

    var t = rol(a, 5) + f + e + w + k

    e = d
    d = c
    c = rol(b, 30)
    b = a
    a = t
    j++
  }

  k = 1518500249
  while (j < 16) loop(M.readInt32BE(j * 4), (b & c) | ((~b) & d))
  while (j < 20) loop(calcW(), (b & c) | ((~b) & d))
  k = 1859775393
  while (j < 40) loop(calcW(), b ^ c ^ d)
  k = -1894007588
  while (j < 60) loop(calcW(), (b & c) | (b & d) | (c & d))
  k = -899497514
  while (j < 80) loop(calcW(), b ^ c ^ d)

  this._a = (a + this._a) | 0
  this._b = (b + this._b) | 0
  this._c = (c + this._c) | 0
  this._d = (d + this._d) | 0
  this._e = (e + this._e) | 0
}

Sha1.prototype._hash = function () {
  var H = new Buffer(20)

  H.writeInt32BE(this._a|0, 0)
  H.writeInt32BE(this._b|0, 4)
  H.writeInt32BE(this._c|0, 8)
  H.writeInt32BE(this._d|0, 12)
  H.writeInt32BE(this._e|0, 16)

  return H
}

module.exports = Sha1


}).call(this,require("buffer").Buffer)
},{"./hash":98,"buffer":"buffer","inherits":143}],101:[function(require,module,exports){
(function (Buffer){
/**
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-256, as defined
 * in FIPS 180-2
 * Version 2.2-beta Copyright Angel Marin, Paul Johnston 2000 - 2009.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 *
 */

var inherits = require('inherits')
var SHA256 = require('./sha256')
var Hash = require('./hash')

var W = new Array(64)

function Sha224() {
  this.init()

  this._w = W // new Array(64)

  Hash.call(this, 64, 56)
}

inherits(Sha224, SHA256)

Sha224.prototype.init = function () {
  this._a = 0xc1059ed8|0
  this._b = 0x367cd507|0
  this._c = 0x3070dd17|0
  this._d = 0xf70e5939|0
  this._e = 0xffc00b31|0
  this._f = 0x68581511|0
  this._g = 0x64f98fa7|0
  this._h = 0xbefa4fa4|0

  return this
}

Sha224.prototype._hash = function () {
  var H = new Buffer(28)

  H.writeInt32BE(this._a,  0)
  H.writeInt32BE(this._b,  4)
  H.writeInt32BE(this._c,  8)
  H.writeInt32BE(this._d, 12)
  H.writeInt32BE(this._e, 16)
  H.writeInt32BE(this._f, 20)
  H.writeInt32BE(this._g, 24)

  return H
}

module.exports = Sha224

}).call(this,require("buffer").Buffer)
},{"./hash":98,"./sha256":102,"buffer":"buffer","inherits":143}],102:[function(require,module,exports){
(function (Buffer){
/**
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-256, as defined
 * in FIPS 180-2
 * Version 2.2-beta Copyright Angel Marin, Paul Johnston 2000 - 2009.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 *
 */

var inherits = require('inherits')
var Hash = require('./hash')

var K = [
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5,
  0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3,
  0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC,
  0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7,
  0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13,
  0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3,
  0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5,
  0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208,
  0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2
]

var W = new Array(64)

function Sha256() {
  this.init()

  this._w = W // new Array(64)

  Hash.call(this, 64, 56)
}

inherits(Sha256, Hash)

Sha256.prototype.init = function () {
  this._a = 0x6a09e667|0
  this._b = 0xbb67ae85|0
  this._c = 0x3c6ef372|0
  this._d = 0xa54ff53a|0
  this._e = 0x510e527f|0
  this._f = 0x9b05688c|0
  this._g = 0x1f83d9ab|0
  this._h = 0x5be0cd19|0

  return this
}

function S (X, n) {
  return (X >>> n) | (X << (32 - n));
}

function R (X, n) {
  return (X >>> n);
}

function Ch (x, y, z) {
  return ((x & y) ^ ((~x) & z));
}

function Maj (x, y, z) {
  return ((x & y) ^ (x & z) ^ (y & z));
}

function Sigma0256 (x) {
  return (S(x, 2) ^ S(x, 13) ^ S(x, 22));
}

function Sigma1256 (x) {
  return (S(x, 6) ^ S(x, 11) ^ S(x, 25));
}

function Gamma0256 (x) {
  return (S(x, 7) ^ S(x, 18) ^ R(x, 3));
}

function Gamma1256 (x) {
  return (S(x, 17) ^ S(x, 19) ^ R(x, 10));
}

Sha256.prototype._update = function(M) {
  var W = this._w

  var a = this._a | 0
  var b = this._b | 0
  var c = this._c | 0
  var d = this._d | 0
  var e = this._e | 0
  var f = this._f | 0
  var g = this._g | 0
  var h = this._h | 0

  var j = 0

  function calcW() { return Gamma1256(W[j - 2]) + W[j - 7] + Gamma0256(W[j - 15]) + W[j - 16] }
  function loop(w) {
    W[j] = w

    var T1 = h + Sigma1256(e) + Ch(e, f, g) + K[j] + w
    var T2 = Sigma0256(a) + Maj(a, b, c);

    h = g;
    g = f;
    f = e;
    e = d + T1;
    d = c;
    c = b;
    b = a;
    a = T1 + T2;

    j++
  }

  while (j < 16) loop(M.readInt32BE(j * 4))
  while (j < 64) loop(calcW())

  this._a = (a + this._a) | 0
  this._b = (b + this._b) | 0
  this._c = (c + this._c) | 0
  this._d = (d + this._d) | 0
  this._e = (e + this._e) | 0
  this._f = (f + this._f) | 0
  this._g = (g + this._g) | 0
  this._h = (h + this._h) | 0
};

Sha256.prototype._hash = function () {
  var H = new Buffer(32)

  H.writeInt32BE(this._a,  0)
  H.writeInt32BE(this._b,  4)
  H.writeInt32BE(this._c,  8)
  H.writeInt32BE(this._d, 12)
  H.writeInt32BE(this._e, 16)
  H.writeInt32BE(this._f, 20)
  H.writeInt32BE(this._g, 24)
  H.writeInt32BE(this._h, 28)

  return H
}

module.exports = Sha256

}).call(this,require("buffer").Buffer)
},{"./hash":98,"buffer":"buffer","inherits":143}],103:[function(require,module,exports){
(function (Buffer){
var inherits = require('inherits')
var SHA512 = require('./sha512');
var Hash = require('./hash')

var W = new Array(160)

function Sha384() {
  this.init()
  this._w = W

  Hash.call(this, 128, 112)
}

inherits(Sha384, SHA512)

Sha384.prototype.init = function () {
  this._a = 0xcbbb9d5d|0
  this._b = 0x629a292a|0
  this._c = 0x9159015a|0
  this._d = 0x152fecd8|0
  this._e = 0x67332667|0
  this._f = 0x8eb44a87|0
  this._g = 0xdb0c2e0d|0
  this._h = 0x47b5481d|0

  this._al = 0xc1059ed8|0
  this._bl = 0x367cd507|0
  this._cl = 0x3070dd17|0
  this._dl = 0xf70e5939|0
  this._el = 0xffc00b31|0
  this._fl = 0x68581511|0
  this._gl = 0x64f98fa7|0
  this._hl = 0xbefa4fa4|0

  return this
}

Sha384.prototype._hash = function () {
  var H = new Buffer(48)

  function writeInt64BE(h, l, offset) {
    H.writeInt32BE(h, offset)
    H.writeInt32BE(l, offset + 4)
  }

  writeInt64BE(this._a, this._al, 0)
  writeInt64BE(this._b, this._bl, 8)
  writeInt64BE(this._c, this._cl, 16)
  writeInt64BE(this._d, this._dl, 24)
  writeInt64BE(this._e, this._el, 32)
  writeInt64BE(this._f, this._fl, 40)

  return H
}

module.exports = Sha384

}).call(this,require("buffer").Buffer)
},{"./hash":98,"./sha512":104,"buffer":"buffer","inherits":143}],104:[function(require,module,exports){
(function (Buffer){
var inherits = require('inherits')
var Hash = require('./hash')

var K = [
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd,
  0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
  0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019,
  0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe,
  0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
  0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1,
  0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3,
  0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483,
  0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210,
  0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
  0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725,
  0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926,
  0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
  0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8,
  0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001,
  0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
  0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910,
  0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53,
  0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
  0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb,
  0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60,
  0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9,
  0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207,
  0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
  0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6,
  0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493,
  0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
  0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a,
  0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817
]

var W = new Array(160)

function Sha512() {
  this.init()
  this._w = W

  Hash.call(this, 128, 112)
}

inherits(Sha512, Hash)

Sha512.prototype.init = function () {
  this._a = 0x6a09e667|0
  this._b = 0xbb67ae85|0
  this._c = 0x3c6ef372|0
  this._d = 0xa54ff53a|0
  this._e = 0x510e527f|0
  this._f = 0x9b05688c|0
  this._g = 0x1f83d9ab|0
  this._h = 0x5be0cd19|0

  this._al = 0xf3bcc908|0
  this._bl = 0x84caa73b|0
  this._cl = 0xfe94f82b|0
  this._dl = 0x5f1d36f1|0
  this._el = 0xade682d1|0
  this._fl = 0x2b3e6c1f|0
  this._gl = 0xfb41bd6b|0
  this._hl = 0x137e2179|0

  return this
}

function S (X, Xl, n) {
  return (X >>> n) | (Xl << (32 - n))
}

function Ch (x, y, z) {
  return ((x & y) ^ ((~x) & z));
}

function Maj (x, y, z) {
  return ((x & y) ^ (x & z) ^ (y & z));
}

Sha512.prototype._update = function(M) {
  var W = this._w

  var a = this._a | 0
  var b = this._b | 0
  var c = this._c | 0
  var d = this._d | 0
  var e = this._e | 0
  var f = this._f | 0
  var g = this._g | 0
  var h = this._h | 0

  var al = this._al | 0
  var bl = this._bl | 0
  var cl = this._cl | 0
  var dl = this._dl | 0
  var el = this._el | 0
  var fl = this._fl | 0
  var gl = this._gl | 0
  var hl = this._hl | 0

  var i = 0, j = 0
  var Wi, Wil
  function calcW() {
    var x  = W[j - 15*2]
    var xl = W[j - 15*2 + 1]
    var gamma0  = S(x, xl, 1) ^ S(x, xl, 8) ^ (x >>> 7)
    var gamma0l = S(xl, x, 1) ^ S(xl, x, 8) ^ S(xl, x, 7)

    x  = W[j - 2*2]
    xl = W[j - 2*2 + 1]
    var gamma1  = S(x, xl, 19) ^ S(xl, x, 29) ^ (x >>> 6)
    var gamma1l = S(xl, x, 19) ^ S(x, xl, 29) ^ S(xl, x, 6)

    // W[i] = gamma0 + W[i - 7] + gamma1 + W[i - 16]
    var Wi7  = W[j - 7*2]
    var Wi7l = W[j - 7*2 + 1]

    var Wi16  = W[j - 16*2]
    var Wi16l = W[j - 16*2 + 1]

    Wil = gamma0l + Wi7l
    Wi  = gamma0  + Wi7 + ((Wil >>> 0) < (gamma0l >>> 0) ? 1 : 0)
    Wil = Wil + gamma1l
    Wi  = Wi  + gamma1  + ((Wil >>> 0) < (gamma1l >>> 0) ? 1 : 0)
    Wil = Wil + Wi16l
    Wi  = Wi  + Wi16 + ((Wil >>> 0) < (Wi16l >>> 0) ? 1 : 0)
  }

  function loop() {
    W[j] = Wi
    W[j + 1] = Wil

    var maj = Maj(a, b, c)
    var majl = Maj(al, bl, cl)

    var sigma0h = S(a, al, 28) ^ S(al, a, 2) ^ S(al, a, 7)
    var sigma0l = S(al, a, 28) ^ S(a, al, 2) ^ S(a, al, 7)
    var sigma1h = S(e, el, 14) ^ S(e, el, 18) ^ S(el, e, 9)
    var sigma1l = S(el, e, 14) ^ S(el, e, 18) ^ S(e, el, 9)

    // t1 = h + sigma1 + ch + K[i] + W[i]
    var Ki = K[j]
    var Kil = K[j + 1]

    var ch = Ch(e, f, g)
    var chl = Ch(el, fl, gl)

    var t1l = hl + sigma1l
    var t1 = h + sigma1h + ((t1l >>> 0) < (hl >>> 0) ? 1 : 0)
    t1l = t1l + chl
    t1 = t1 + ch + ((t1l >>> 0) < (chl >>> 0) ? 1 : 0)
    t1l = t1l + Kil
    t1 = t1 + Ki + ((t1l >>> 0) < (Kil >>> 0) ? 1 : 0)
    t1l = t1l + Wil
    t1 = t1 + Wi + ((t1l >>> 0) < (Wil >>> 0) ? 1 : 0)

    // t2 = sigma0 + maj
    var t2l = sigma0l + majl
    var t2 = sigma0h + maj + ((t2l >>> 0) < (sigma0l >>> 0) ? 1 : 0)

    h  = g
    hl = gl
    g  = f
    gl = fl
    f  = e
    fl = el
    el = (dl + t1l) | 0
    e  = (d + t1 + ((el >>> 0) < (dl >>> 0) ? 1 : 0)) | 0
    d  = c
    dl = cl
    c  = b
    cl = bl
    b  = a
    bl = al
    al = (t1l + t2l) | 0
    a  = (t1 + t2 + ((al >>> 0) < (t1l >>> 0) ? 1 : 0)) | 0

    i++
    j += 2
  }

  while (i < 16) {
    Wi = M.readInt32BE(j * 4)
    Wil = M.readInt32BE(j * 4 + 4)

    loop()
  }

  while (i < 80) {
    calcW()
    loop()
  }

  this._al = (this._al + al) | 0
  this._bl = (this._bl + bl) | 0
  this._cl = (this._cl + cl) | 0
  this._dl = (this._dl + dl) | 0
  this._el = (this._el + el) | 0
  this._fl = (this._fl + fl) | 0
  this._gl = (this._gl + gl) | 0
  this._hl = (this._hl + hl) | 0

  this._a = (this._a + a + ((this._al >>> 0) < (al >>> 0) ? 1 : 0)) | 0
  this._b = (this._b + b + ((this._bl >>> 0) < (bl >>> 0) ? 1 : 0)) | 0
  this._c = (this._c + c + ((this._cl >>> 0) < (cl >>> 0) ? 1 : 0)) | 0
  this._d = (this._d + d + ((this._dl >>> 0) < (dl >>> 0) ? 1 : 0)) | 0
  this._e = (this._e + e + ((this._el >>> 0) < (el >>> 0) ? 1 : 0)) | 0
  this._f = (this._f + f + ((this._fl >>> 0) < (fl >>> 0) ? 1 : 0)) | 0
  this._g = (this._g + g + ((this._gl >>> 0) < (gl >>> 0) ? 1 : 0)) | 0
  this._h = (this._h + h + ((this._hl >>> 0) < (hl >>> 0) ? 1 : 0)) | 0
}

Sha512.prototype._hash = function () {
  var H = new Buffer(64)

  function writeInt64BE(h, l, offset) {
    H.writeInt32BE(h, offset)
    H.writeInt32BE(l, offset + 4)
  }

  writeInt64BE(this._a, this._al, 0)
  writeInt64BE(this._b, this._bl, 8)
  writeInt64BE(this._c, this._cl, 16)
  writeInt64BE(this._d, this._dl, 24)
  writeInt64BE(this._e, this._el, 32)
  writeInt64BE(this._f, this._fl, 40)
  writeInt64BE(this._g, this._gl, 48)
  writeInt64BE(this._h, this._hl, 56)

  return H
}

module.exports = Sha512

}).call(this,require("buffer").Buffer)
},{"./hash":98,"buffer":"buffer","inherits":143}],105:[function(require,module,exports){
(function (Buffer){
'use strict';
var createHash = require('create-hash/browser');
var inherits = require('inherits')

var Transform = require('stream').Transform

var ZEROS = new Buffer(128)
ZEROS.fill(0)

function Hmac(alg, key) {
  Transform.call(this)

  if (typeof key === 'string') {
    key = new Buffer(key)
  }

  var blocksize = (alg === 'sha512' || alg === 'sha384') ? 128 : 64

  this._alg = alg
  this._key = key

  if (key.length > blocksize) {
    key = createHash(alg).update(key).digest()

  } else if (key.length < blocksize) {
    key = Buffer.concat([key, ZEROS], blocksize)
  }

  var ipad = this._ipad = new Buffer(blocksize)
  var opad = this._opad = new Buffer(blocksize)

  for (var i = 0; i < blocksize; i++) {
    ipad[i] = key[i] ^ 0x36
    opad[i] = key[i] ^ 0x5C
  }

  this._hash = createHash(alg).update(ipad)
}

inherits(Hmac, Transform)

Hmac.prototype.update = function (data, enc) {
  this._hash.update(data, enc)

  return this
}

Hmac.prototype._transform = function (data, _, next) {
  this._hash.update(data)

  next()
}

Hmac.prototype._flush = function (next) {
  this.push(this.digest())

  next()
}

Hmac.prototype.digest = function (enc) {
  var h = this._hash.digest()

  return createHash(this._alg).update(this._opad).update(h).digest(enc)
}

module.exports = function createHmac(alg, key) {
  return new Hmac(alg, key)
}

}).call(this,require("buffer").Buffer)
},{"buffer":"buffer","create-hash/browser":94,"inherits":143,"stream":159}],106:[function(require,module,exports){
(function (Buffer){
var generatePrime = require('./lib/generatePrime');
var primes = require('./lib/primes');

var DH = require('./lib/dh');

function getDiffieHellman(mod) {
  var prime = new Buffer(primes[mod].prime, 'hex');
  var gen = new Buffer(primes[mod].gen, 'hex');

  return new DH(prime, gen);
}

function createDiffieHellman(prime, enc, generator, genc) {
  if (Buffer.isBuffer(enc) || (typeof enc === 'string' && ['hex', 'binary', 'base64'].indexOf(enc) === -1)) {
    genc = generator;
    generator = enc;
    enc = undefined;
  }

  enc = enc || 'binary';
  genc = genc || 'binary';
  generator = generator || new Buffer([2]);

  if (!Buffer.isBuffer(generator)) {
    generator = new Buffer(generator, genc);
  }

  if (typeof prime === 'number') {
    return new DH(generatePrime(prime, generator), generator, true);
  }

  if (!Buffer.isBuffer(prime)) {
    prime = new Buffer(prime, enc);
  }

  return new DH(prime, generator, true);
}

exports.DiffieHellmanGroup = exports.createDiffieHellmanGroup = exports.getDiffieHellman = getDiffieHellman;
exports.createDiffieHellman = exports.DiffieHellman = createDiffieHellman;

}).call(this,require("buffer").Buffer)
},{"./lib/dh":107,"./lib/generatePrime":108,"./lib/primes":109,"buffer":"buffer"}],107:[function(require,module,exports){
(function (Buffer){
var BN = require('bn.js');
var MillerRabin = require('miller-rabin');
var millerRabin = new MillerRabin();
var TWENTYFOUR = new BN(24);
var ELEVEN = new BN(11);
var TEN = new BN(10);
var THREE = new BN(3);
var SEVEN = new BN(7);
var primes = require('./generatePrime');
var randomBytes = require('randombytes');
module.exports = DH;

function setPublicKey(pub, enc) {
  enc = enc || 'utf8';
  if (!Buffer.isBuffer(pub)) {
    pub = new Buffer(pub, enc);
  }
  this._pub = new BN(pub);
  return this;
}

function setPrivateKey(priv, enc) {
  enc = enc || 'utf8';
  if (!Buffer.isBuffer(priv)) {
    priv = new Buffer(priv, enc);
  }
  this._priv = new BN(priv);
  return this;
}

var primeCache = {};
function checkPrime(prime, generator) {
  var gen = generator.toString('hex');
  var hex = [gen, prime.toString(16)].join('_');
  if (hex in primeCache) {
    return primeCache[hex];
  }
  var error = 0;
  
  if (prime.isEven() ||
    !primes.simpleSieve ||
    !primes.fermatTest(prime) ||
    !millerRabin.test(prime)) {
    //not a prime so +1
    error += 1;
    
    if (gen === '02' || gen === '05') {
      // we'd be able to check the generator
      // it would fail so +8
      error += 8;
    } else {
      //we wouldn't be able to test the generator
      // so +4
      error += 4;
    }
    primeCache[hex] = error;
    return error;
  }
  if (!millerRabin.test(prime.shrn(1))) {
    //not a safe prime
    error += 2;
  }
  var rem;
  switch (gen) {
    case '02':
      if (prime.mod(TWENTYFOUR).cmp(ELEVEN)) {
        // unsuidable generator
        error += 8;
      }
      break;
    case '05':
      rem = prime.mod(TEN);
      if (rem.cmp(THREE) && rem.cmp(SEVEN)) {
        // prime mod 10 needs to equal 3 or 7
        error += 8;
      } 
      break;
    default: 
      error += 4;
  }
  primeCache[hex] = error;
  return error;
}

function defineError (self, error) {
  try {
    Object.defineProperty(self, 'verifyError', {
      enumerable: true,
      value: error,
      writable: false
    });
  } catch(e) {
    self.verifyError = error;
  }
}
function DH(prime, generator, malleable) {
  this.setGenerator(generator);
  this.__prime = new BN(prime);
  this._prime = BN.mont(this.__prime);
  this._primeLen = prime.length;
  this._pub = void 0;
  this._priv = void 0;
  
  if (malleable) {
    this.setPublicKey = setPublicKey;
    this.setPrivateKey = setPrivateKey;
    defineError(this, checkPrime(this.__prime, generator));
  } else {
    defineError(this, 8);
  }
}

DH.prototype.generateKeys = function () {
  if (!this._priv) {
    this._priv = new BN(randomBytes(this._primeLen));
  }
  this._pub = this._gen.toRed(this._prime).redPow(this._priv).fromRed();
  return this.getPublicKey();
};

DH.prototype.computeSecret = function (other) {
  other = new BN(other);
  other = other.toRed(this._prime);
  var secret = other.redPow(this._priv).fromRed();
  var out = new Buffer(secret.toArray());
  var prime = this.getPrime();
  if (out.length < prime.length) {
    var front = new Buffer(prime.length - out.length);
    front.fill(0);
    out = Buffer.concat([front, out]);
  }
  return out;
};

DH.prototype.getPublicKey = function getPublicKey(enc) {
  return formatReturnValue(this._pub, enc);
};

DH.prototype.getPrivateKey = function getPrivateKey(enc) {
  return formatReturnValue(this._priv, enc);
};

DH.prototype.getPrime = function (enc) {
  return formatReturnValue(this.__prime, enc);
};

DH.prototype.getGenerator = function (enc) {
  return formatReturnValue(this._gen, enc);
};

DH.prototype.setGenerator = function (gen, enc) {
  enc = enc || 'utf8';
  if (!Buffer.isBuffer(gen)) {
    gen = new Buffer(gen, enc);
  }
  this._gen = new BN(gen);
  return this;
};

function formatReturnValue(bn, enc) {
  var buf = new Buffer(bn.toArray());
  if (!enc) {
    return buf;
  } else {
    return buf.toString(enc);
  }
}
}).call(this,require("buffer").Buffer)
},{"./generatePrime":108,"bn.js":110,"buffer":"buffer","miller-rabin":111,"randombytes":141}],108:[function(require,module,exports){
var randomBytes = require('randombytes');
module.exports = findPrime;
findPrime.simpleSieve = simpleSieve;
findPrime.fermatTest = fermatTest;
var BN = require('bn.js');
var TWENTYFOUR = new BN(24);
var MillerRabin = require('miller-rabin');
var millerRabin = new MillerRabin();
var ONE = new BN(1);
var TWO = new BN(2);
var FIVE = new BN(5);
var SIXTEEN = new BN(16);
var EIGHT = new BN(8);
var TEN = new BN(10);
var THREE = new BN(3);
var SEVEN = new BN(7);
var ELEVEN = new BN(11);
var FOUR = new BN(4);
var TWELVE = new BN(12);
var primes = null;

function _getPrimes() {
  if (primes !== null)
    return primes;

  var limit = 0x100000;
  var res = [];
  res[0] = 2;
  for (var i = 1, k = 3; k < limit; k += 2) {
    var sqrt = Math.ceil(Math.sqrt(k));
    for (var j = 0; j < i && res[j] <= sqrt; j++)
      if (k % res[j] === 0)
        break;

    if (i !== j && res[j] <= sqrt)
      continue;

    res[i++] = k;
  }
  primes = res;
  return res;
}

function simpleSieve(p) {
  var primes = _getPrimes();

  for (var i = 0; i < primes.length; i++)
    if (p.modn(primes[i]) === 0) {
      if (p.cmpn(primes[i]) === 0) {
        return true;
      } else {
        return false;
      }
    }

  return true;
}

function fermatTest(p) {
  var red = BN.mont(p);
  return TWO.toRed(red).redPow(p.subn(1)).fromRed().cmpn(1) === 0;
}

function findPrime(bits, gen) {
  if (bits < 16) {
    // this is what openssl does
    if (gen === 2 || gen === 5) {
      return new BN([0x8c, 0x7b]);
    } else {
      return new BN([0x8c, 0x27]);
    }
  }
  gen = new BN(gen);
  var runs, comp;
  function generateRandom(bits) {
    runs = -1;
    var out = new BN(randomBytes(Math.ceil(bits / 8)));
    while (out.bitLength() > bits) {
      out.ishrn(1);
    }
    if (out.isEven()) {
      out.iadd(ONE);
    }
    if (!out.testn(1)) {
      out.iadd(TWO);
    }
    if (!gen.cmp(TWO)) {
      while (out.mod(TWENTYFOUR).cmp(ELEVEN)) {
        out.iadd(FOUR);
      }
      comp = {
        major: [TWENTYFOUR],
        minor: [TWELVE]
      };
    } else if (!gen.cmp(FIVE)) {
      rem = out.mod(TEN);
      while (rem.cmp(THREE)) {
        out.iadd(FOUR);
        rem = out.mod(TEN);
      }
      comp = {
        major: [FOUR, SIXTEEN],
        minor: [TWO, EIGHT]
      };
    } else {
      comp = {
        major: [FOUR],
        minor: [TWO]
      };
    }
    return out;
  }
  var num = generateRandom(bits);

  var n2 = num.shrn(1);

  while (true) {
    while (num.bitLength() > bits) {
      num = generateRandom(bits);
      n2 = num.shrn(1);
    }
    runs++;
    if (simpleSieve(n2) &&  simpleSieve(num) &&
      fermatTest(n2) &&  fermatTest(num) &&
      millerRabin.test(n2) && millerRabin.test(num)) {
      return num;
    }
    num.iadd(comp.major[runs%comp.major.length]);
    n2.iadd(comp.minor[runs%comp.minor.length]);
  }

}
},{"bn.js":110,"miller-rabin":111,"randombytes":141}],109:[function(require,module,exports){
module.exports={
    "modp1": {
        "gen": "02",
        "prime": "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a63a3620ffffffffffffffff"
    },
    "modp2": {
        "gen": "02",
        "prime": "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece65381ffffffffffffffff"
    },
    "modp5": {
        "gen": "02",
        "prime": "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca237327ffffffffffffffff"
    },
    "modp14": {
        "gen": "02",
        "prime": "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aacaa68ffffffffffffffff"
    },
    "modp15": {
        "gen": "02",
        "prime": "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aaac42dad33170d04507a33a85521abdf1cba64ecfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7abf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf12ffa06d98a0864d87602733ec86a64521f2b18177b200cbbe117577a615d6c770988c0bad946e208e24fa074e5ab3143db5bfce0fd108e4b82d120a93ad2caffffffffffffffff"
    },
    "modp16": {
        "gen": "02",
        "prime": "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aaac42dad33170d04507a33a85521abdf1cba64ecfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7abf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf12ffa06d98a0864d87602733ec86a64521f2b18177b200cbbe117577a615d6c770988c0bad946e208e24fa074e5ab3143db5bfce0fd108e4b82d120a92108011a723c12a787e6d788719a10bdba5b2699c327186af4e23c1a946834b6150bda2583e9ca2ad44ce8dbbbc2db04de8ef92e8efc141fbecaa6287c59474e6bc05d99b2964fa090c3a2233ba186515be7ed1f612970cee2d7afb81bdd762170481cd0069127d5b05aa993b4ea988d8fddc186ffb7dc90a6c08f4df435c934063199ffffffffffffffff"
    },
    "modp17": {
        "gen": "02",
        "prime": "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aaac42dad33170d04507a33a85521abdf1cba64ecfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7abf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf12ffa06d98a0864d87602733ec86a64521f2b18177b200cbbe117577a615d6c770988c0bad946e208e24fa074e5ab3143db5bfce0fd108e4b82d120a92108011a723c12a787e6d788719a10bdba5b2699c327186af4e23c1a946834b6150bda2583e9ca2ad44ce8dbbbc2db04de8ef92e8efc141fbecaa6287c59474e6bc05d99b2964fa090c3a2233ba186515be7ed1f612970cee2d7afb81bdd762170481cd0069127d5b05aa993b4ea988d8fddc186ffb7dc90a6c08f4df435c93402849236c3fab4d27c7026c1d4dcb2602646dec9751e763dba37bdf8ff9406ad9e530ee5db382f413001aeb06a53ed9027d831179727b0865a8918da3edbebcf9b14ed44ce6cbaced4bb1bdb7f1447e6cc254b332051512bd7af426fb8f401378cd2bf5983ca01c64b92ecf032ea15d1721d03f482d7ce6e74fef6d55e702f46980c82b5a84031900b1c9e59e7c97fbec7e8f323a97a7e36cc88be0f1d45b7ff585ac54bd407b22b4154aacc8f6d7ebf48e1d814cc5ed20f8037e0a79715eef29be32806a1d58bb7c5da76f550aa3d8a1fbff0eb19ccb1a313d55cda56c9ec2ef29632387fe8d76e3c0468043e8f663f4860ee12bf2d5b0b7474d6e694f91e6dcc4024ffffffffffffffff"
    },
    "modp18": {
        "gen": "02",
        "prime": "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aaac42dad33170d04507a33a85521abdf1cba64ecfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7abf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf12ffa06d98a0864d87602733ec86a64521f2b18177b200cbbe117577a615d6c770988c0bad946e208e24fa074e5ab3143db5bfce0fd108e4b82d120a92108011a723c12a787e6d788719a10bdba5b2699c327186af4e23c1a946834b6150bda2583e9ca2ad44ce8dbbbc2db04de8ef92e8efc141fbecaa6287c59474e6bc05d99b2964fa090c3a2233ba186515be7ed1f612970cee2d7afb81bdd762170481cd0069127d5b05aa993b4ea988d8fddc186ffb7dc90a6c08f4df435c93402849236c3fab4d27c7026c1d4dcb2602646dec9751e763dba37bdf8ff9406ad9e530ee5db382f413001aeb06a53ed9027d831179727b0865a8918da3edbebcf9b14ed44ce6cbaced4bb1bdb7f1447e6cc254b332051512bd7af426fb8f401378cd2bf5983ca01c64b92ecf032ea15d1721d03f482d7ce6e74fef6d55e702f46980c82b5a84031900b1c9e59e7c97fbec7e8f323a97a7e36cc88be0f1d45b7ff585ac54bd407b22b4154aacc8f6d7ebf48e1d814cc5ed20f8037e0a79715eef29be32806a1d58bb7c5da76f550aa3d8a1fbff0eb19ccb1a313d55cda56c9ec2ef29632387fe8d76e3c0468043e8f663f4860ee12bf2d5b0b7474d6e694f91e6dbe115974a3926f12fee5e438777cb6a932df8cd8bec4d073b931ba3bc832b68d9dd300741fa7bf8afc47ed2576f6936ba424663aab639c5ae4f5683423b4742bf1c978238f16cbe39d652de3fdb8befc848ad922222e04a4037c0713eb57a81a23f0c73473fc646cea306b4bcbc8862f8385ddfa9d4b7fa2c087e879683303ed5bdd3a062b3cf5b3a278a66d2a13f83f44f82ddf310ee074ab6a364597e899a0255dc164f31cc50846851df9ab48195ded7ea1b1d510bd7ee74d73faf36bc31ecfa268359046f4eb879f924009438b481c6cd7889a002ed5ee382bc9190da6fc026e479558e4475677e9aa9e3050e2765694dfc81f56e880b96e7160c980dd98edd3dfffffffffffffffff"
    }
}
},{}],110:[function(require,module,exports){
arguments[4][27][0].apply(exports,arguments)
},{"dup":27}],111:[function(require,module,exports){
var bn = require('bn.js');
var brorand = require('brorand');

function MillerRabin(rand) {
  this.rand = rand || new brorand.Rand();
}
module.exports = MillerRabin;

MillerRabin.create = function create(rand) {
  return new MillerRabin(rand);
};

MillerRabin.prototype._rand = function _rand(n) {
  var len = n.bitLength();
  var buf = this.rand.generate(Math.ceil(len / 8));

  // Set low bits
  buf[0] |= 3;

  // Mask high bits
  var mask = len & 0x7;
  if (mask !== 0)
    buf[buf.length - 1] >>= 7 - mask;

  return new bn(buf);
}

MillerRabin.prototype.test = function test(n, k, cb) {
  var len = n.bitLength();
  var red = bn.mont(n);
  var rone = new bn(1).toRed(red);

  if (!k)
    k = Math.max(1, (len / 48) | 0);

  // Find d and s, (n - 1) = (2 ^ s) * d;
  var n1 = n.subn(1);
  var n2 = n1.subn(1);
  for (var s = 0; !n1.testn(s); s++) {}
  var d = n.shrn(s);

  var rn1 = n1.toRed(red);

  var prime = true;
  for (; k > 0; k--) {
    var a = this._rand(n2);
    if (cb)
      cb(a);

    var x = a.toRed(red).redPow(d);
    if (x.cmp(rone) === 0 || x.cmp(rn1) === 0)
      continue;

    for (var i = 1; i < s; i++) {
      x = x.redSqr();

      if (x.cmp(rone) === 0)
        return false;
      if (x.cmp(rn1) === 0)
        break;
    }

    if (i === s)
      return false;
  }

  return prime;
};

MillerRabin.prototype.getDivisor = function getDivisor(n, k) {
  var len = n.bitLength();
  var red = bn.mont(n);
  var rone = new bn(1).toRed(red);

  if (!k)
    k = Math.max(1, (len / 48) | 0);

  // Find d and s, (n - 1) = (2 ^ s) * d;
  var n1 = n.subn(1);
  var n2 = n1.subn(1);
  for (var s = 0; !n1.testn(s); s++) {}
  var d = n.shrn(s);

  var rn1 = n1.toRed(red);

  var prime = true;
  for (; k > 0; k--) {
    var a = this._rand(n2);

    var g = n.gcd(a);
    if (g.cmpn(1) !== 0)
      return g;

    var x = a.toRed(red).redPow(d);
    if (x.cmp(rone) === 0 || x.cmp(rn1) === 0)
      continue;

    for (var i = 1; i < s; i++) {
      x = x.redSqr();

      if (x.cmp(rone) === 0)
        return x.fromRed().subn(1).gcd(n);
      if (x.cmp(rn1) === 0)
        break;
    }

    if (i === s) {
      x = x.redSqr();
      return x.fromRed().subn(1).gcd(n);
    }
  }

  return prime;
};

},{"bn.js":110,"brorand":112}],112:[function(require,module,exports){
arguments[4][41][0].apply(exports,arguments)
},{"dup":41}],113:[function(require,module,exports){
(function (Buffer){
var createHmac = require('create-hmac')

exports.pbkdf2 = pbkdf2
function pbkdf2 (password, salt, iterations, keylen, digest, callback) {
  if (typeof digest === 'function') {
    callback = digest
    digest = undefined
  }

  if (typeof callback !== 'function') {
    throw new Error('No callback provided to pbkdf2')
  }

  var result = pbkdf2Sync(password, salt, iterations, keylen, digest)
  setTimeout(function () {
    callback(undefined, result)
  })
}

exports.pbkdf2Sync = pbkdf2Sync
function pbkdf2Sync (password, salt, iterations, keylen, digest) {
  if (typeof iterations !== 'number')
    throw new TypeError('Iterations not a number')

  if (iterations < 0)
    throw new TypeError('Bad iterations')

  if (typeof keylen !== 'number')
    throw new TypeError('Key length not a number')

  if (keylen < 0)
    throw new TypeError('Bad key length')

  digest = digest || 'sha1'

  if (!Buffer.isBuffer(password)) password = new Buffer(password)
  if (!Buffer.isBuffer(salt)) salt = new Buffer(salt)

  var hLen
  var l = 1
  var DK = new Buffer(keylen)
  var block1 = new Buffer(salt.length + 4)
  salt.copy(block1, 0, 0, salt.length)

  var r
  var T

  for (var i = 1; i <= l; i++) {
    block1.writeUInt32BE(i, salt.length)
    var U = createHmac(digest, password).update(block1).digest()

    if (!hLen) {
      hLen = U.length
      T = new Buffer(hLen)
      l = Math.ceil(keylen / hLen)
      r = keylen - (l - 1) * hLen

      if (keylen > (Math.pow(2, 32) - 1) * hLen)
        throw new TypeError('keylen exceeds maximum length')
    }

    U.copy(T, 0, 0, hLen)

    for (var j = 1; j < iterations; j++) {
      U = createHmac(digest, password).update(U).digest()

      for (var k = 0; k < hLen; k++) {
        T[k] ^= U[k]
      }
    }

    var destPos = (i - 1) * hLen
    var len = (i === l ? r : hLen)
    T.copy(DK, destPos, 0, len)
  }

  return DK
}

}).call(this,require("buffer").Buffer)
},{"buffer":"buffer","create-hmac":105}],114:[function(require,module,exports){

module.exports = function (exports, crypto) {
  exports.publicEncrypt = require('./publicEncrypt')(crypto);
  exports.privateDecrypt = require('./privateDecrypt')(crypto);
};
},{"./privateDecrypt":138,"./publicEncrypt":139}],115:[function(require,module,exports){
(function (Buffer){
module.exports = function (seed, len, crypto) {
  var t = new Buffer('');
  var  i = 0, c;
  while (t.length < len) {
    c = i2ops(i++);
    t = Buffer.concat([t, crypto.createHash('sha1').update(seed).update(c).digest()]);
  }
  return t.slice(0, len);
};

function i2ops(c) {
  var out = new Buffer(4);
  out.writeUInt32BE(c,0);
  return out;
}
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],116:[function(require,module,exports){
arguments[4][27][0].apply(exports,arguments)
},{"dup":27}],117:[function(require,module,exports){
arguments[4][28][0].apply(exports,arguments)
},{"bn.js":116,"buffer":"buffer","dup":28}],118:[function(require,module,exports){
arguments[4][49][0].apply(exports,arguments)
},{"buffer":"buffer","dup":49}],119:[function(require,module,exports){
arguments[4][50][0].apply(exports,arguments)
},{"dup":50}],120:[function(require,module,exports){
arguments[4][51][0].apply(exports,arguments)
},{"asn1.js":124,"asn1.js-rfc3280":123,"dup":51}],121:[function(require,module,exports){
arguments[4][52][0].apply(exports,arguments)
},{"./EVP_BytesToKey":118,"buffer":"buffer","dup":52}],122:[function(require,module,exports){
arguments[4][53][0].apply(exports,arguments)
},{"./aesid.json":119,"./asn1":120,"./fixProc":121,"buffer":"buffer","dup":53,"pemstrip":137}],123:[function(require,module,exports){
arguments[4][54][0].apply(exports,arguments)
},{"asn1.js":124,"dup":54}],124:[function(require,module,exports){
arguments[4][55][0].apply(exports,arguments)
},{"./asn1/api":125,"./asn1/base":127,"./asn1/constants":131,"./asn1/decoders":133,"./asn1/encoders":135,"bn.js":116,"dup":55}],125:[function(require,module,exports){
arguments[4][56][0].apply(exports,arguments)
},{"../asn1":124,"dup":56,"inherits":143,"vm":163}],126:[function(require,module,exports){
arguments[4][57][0].apply(exports,arguments)
},{"../base":127,"buffer":"buffer","dup":57,"inherits":143}],127:[function(require,module,exports){
arguments[4][58][0].apply(exports,arguments)
},{"./buffer":126,"./node":128,"./reporter":129,"dup":58}],128:[function(require,module,exports){
arguments[4][59][0].apply(exports,arguments)
},{"../base":127,"dup":59,"minimalistic-assert":136}],129:[function(require,module,exports){
arguments[4][60][0].apply(exports,arguments)
},{"dup":60,"inherits":143}],130:[function(require,module,exports){
arguments[4][61][0].apply(exports,arguments)
},{"../constants":131,"dup":61}],131:[function(require,module,exports){
arguments[4][62][0].apply(exports,arguments)
},{"./der":130,"dup":62}],132:[function(require,module,exports){
arguments[4][63][0].apply(exports,arguments)
},{"../../asn1":124,"dup":63,"inherits":143}],133:[function(require,module,exports){
arguments[4][64][0].apply(exports,arguments)
},{"./der":132,"dup":64}],134:[function(require,module,exports){
arguments[4][65][0].apply(exports,arguments)
},{"../../asn1":124,"buffer":"buffer","dup":65,"inherits":143}],135:[function(require,module,exports){
arguments[4][66][0].apply(exports,arguments)
},{"./der":134,"dup":66}],136:[function(require,module,exports){
arguments[4][67][0].apply(exports,arguments)
},{"dup":67}],137:[function(require,module,exports){
arguments[4][68][0].apply(exports,arguments)
},{"dup":68}],138:[function(require,module,exports){
(function (Buffer){
var parseKeys = require('parse-asn1');
var mgf = require('./mgf');
var xor = require('./xor');
var bn = require('bn.js');
var crt = require('browserify-rsa');
module.exports = function (crypto) {
  return privateDecrypt;
  function privateDecrypt(private_key, enc) {
    var padding;
    if (private_key.padding) {
      padding = private_key.padding;
    } else {
      padding = 4;
    }
    
    var key = parseKeys(private_key, crypto);
    var k = key.modulus.byteLength();
    if (enc.length > k || new bn(enc).cmp(key.modulus) >= 0) {
      throw new Error('decryption error');
    }
    var msg = crt(enc, key, crypto);
    var zBuffer = new Buffer(k - msg.length);
    zBuffer.fill(0);
    msg = Buffer.concat([zBuffer, msg], k);
    if (padding === 4) {
      return oaep(key, msg, crypto);
    } else if (padding === 1) {
      return pkcs1(key, msg, crypto);
    } else if (padding === 3) {
      return msg;
    } else {
      throw new Error('unknown padding');
    }
  }
};

function oaep(key, msg, crypto){
  var n = key.modulus;
  var k = key.modulus.byteLength();
  var mLen = msg.length;
  var iHash = crypto.createHash('sha1').update(new Buffer('')).digest();
  var hLen = iHash.length;
  var hLen2 = 2 * hLen;
  if (msg[0] !== 0) {
    throw new Error('decryption error');
  }
  var maskedSeed = msg.slice(1, hLen + 1);
  var maskedDb =  msg.slice(hLen + 1);
  var seed = xor(maskedSeed, mgf(maskedDb, hLen, crypto));
  var db = xor(maskedDb, mgf(seed, k - hLen - 1, crypto));
  if (compare(iHash, db.slice(0, hLen))) {
    throw new Error('decryption error');
  }
  var i = hLen;
  while (db[i] === 0) {
    i++;
  }
  if (db[i++] !== 1) {
    throw new Error('decryption error');
  }
  return db.slice(i);
}

function pkcs1(key, msg, crypto){
  var p1 = msg.slice(0, 2);
  var i = 2;
  var status = 0;
  while (msg[i++] !== 0) {
    if (i >= msg.length) {
      status++;
      break;
    }
  }
  var ps = msg.slice(2, i - 1);
  var p2 = msg.slice(i - 1, i);

  if (p1.toString('hex') !== '0002') {
    status++;
  }
  if (ps.length < 8) {
    status++;
  }
  return  msg.slice(i);
}
function compare(a, b){
  var dif = 0;
  var len = a.length;
  if (a.length !== b.length) {
    dif++;
    len = Math.min(a.length, b.length);
  }
  var i = -1;
  while (++i < len) {
    dif += (a[i] ^ b[i]);
  }
  return dif;
}
}).call(this,require("buffer").Buffer)
},{"./mgf":115,"./xor":140,"bn.js":116,"browserify-rsa":117,"buffer":"buffer","parse-asn1":122}],139:[function(require,module,exports){
(function (Buffer){
var parseKeys = require('parse-asn1');
var mgf = require('./mgf');
var xor = require('./xor');
var bn = require('bn.js');
var constants = {
  RSA_PKCS1_OAEP_PADDING: 4,
  RSA_PKCS1_PADDIN: 1,
  RSA_NO_PADDING: 3
};

module.exports = function (crypto) {
  return publicEncrypt;
  function publicEncrypt(public_key, msg) {
    var padding;
    if (public_key.padding) {
      padding = public_key.padding;
    } else {
      padding = 4;
    }
    var key = parseKeys(public_key);
    var paddedMsg;
    if (padding === 4) {
      paddedMsg = oaep(key, msg, crypto);
    } else if (padding === 1) {
      paddedMsg = pkcs1(key, msg, crypto);
    } else if (padding === 3) {
      paddedMsg = new bn(msg);
      if (paddedMsg.cmp(key.modulus) >= 0) {
        throw new Error('data too long for modulus');
      }
    } else {
      throw new Error('unknown padding');
    }
    var enc = paddedMsg
      .toRed(bn.mont(key.modulus))
      .redPow(new bn(key.publicExponent))
      .fromRed()
      .toArray();
    return new Buffer(enc);
  }
};

function oaep(key, msg, crypto){
  var k = key.modulus.byteLength();
  var mLen = msg.length;
  var iHash = crypto.createHash('sha1').update(new Buffer('')).digest();
  var hLen = iHash.length;
  var hLen2 = 2 * hLen;
  if (mLen > k - hLen2 - 2) {
    throw new Error('message too long');
  }
  var ps = new Buffer(k - mLen - hLen2 - 2);
  ps.fill(0);
  var dblen = k - hLen - 1;
  var seed = crypto.randomBytes(hLen);
  var maskedDb = xor(Buffer.concat([iHash, ps, new Buffer([1]), msg], dblen), mgf(seed, dblen, crypto));
  var maskedSeed = xor(seed, mgf(maskedDb, hLen, crypto));
  return new bn(Buffer.concat([new Buffer([0]), maskedSeed, maskedDb], k));
}
function pkcs1(key, msg, crypto){
  var mLen = msg.length;
  var k = key.modulus.byteLength();
  if (mLen > k - 11) {
    throw new Error('message too long');
  }
  var ps = nonZero(k - mLen - 3, crypto);
  return new bn(Buffer.concat([new Buffer([0, 2]), ps, new Buffer([0]), msg], k));
}
function nonZero(len, crypto) {
  var out = new Buffer(len);
  var i = 0;
  var cache = crypto.randomBytes(len*2);
  var cur = 0;
  var num;
  while (i < len) {
    if (cur === cache.length) {
      cache = crypto.randomBytes(len*2);
      cur = 0;
    }
    num = cache[cur++];
    if (num) {
      out[i++] = num;
    }
  }
  return out;
}
}).call(this,require("buffer").Buffer)
},{"./mgf":115,"./xor":140,"bn.js":116,"buffer":"buffer","parse-asn1":122}],140:[function(require,module,exports){
module.exports = function xor(a, b) {
  var len = a.length;
  var i = -1;
  while (++i < len) {
    a[i] ^= b[i];
  }
  return a
};
},{}],141:[function(require,module,exports){
(function (process,global,Buffer){
'use strict';

var crypto = global.crypto || global.msCrypto
if(crypto && crypto.getRandomValues) {
  module.exports = randomBytes;
} else {
  module.exports = oldBrowser;
}
function randomBytes(size, cb) {
  var bytes = new Buffer(size); //in browserify, this is an extended Uint8Array
    /* This will not work in older browsers.
     * See https://developer.mozilla.org/en-US/docs/Web/API/window.crypto.getRandomValues
     */

  crypto.getRandomValues(bytes);
  if (typeof cb === 'function') {
    return process.nextTick(function () {
      cb(null, bytes);
    });
  }
  return bytes;
}
function oldBrowser() {
  throw new Error(
      'secure random number generation not supported by this browser\n'+
      'use chrome, FireFox or Internet Explorer 11'
    )
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"_process":147,"buffer":"buffer"}],142:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],143:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],144:[function(require,module,exports){
module.exports = Array.isArray || function (arr) {
  return Object.prototype.toString.call(arr) == '[object Array]';
};

},{}],145:[function(require,module,exports){
exports.endianness = function () { return 'LE' };

exports.hostname = function () {
    if (typeof location !== 'undefined') {
        return location.hostname
    }
    else return '';
};

exports.loadavg = function () { return [] };

exports.uptime = function () { return 0 };

exports.freemem = function () {
    return Number.MAX_VALUE;
};

exports.totalmem = function () {
    return Number.MAX_VALUE;
};

exports.cpus = function () { return [] };

exports.type = function () { return 'Browser' };

exports.release = function () {
    if (typeof navigator !== 'undefined') {
        return navigator.appVersion;
    }
    return '';
};

exports.networkInterfaces
= exports.getNetworkInterfaces
= function () { return {} };

exports.arch = function () { return 'javascript' };

exports.platform = function () { return 'browser' };

exports.tmpdir = exports.tmpDir = function () {
    return '/tmp';
};

exports.EOL = '\n';

},{}],146:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))
},{"_process":147}],147:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;

function drainQueue() {
    if (draining) {
        return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        var i = -1;
        while (++i < len) {
            currentQueue[i]();
        }
        len = queue.length;
    }
    draining = false;
}
process.nextTick = function (fun) {
    queue.push(fun);
    if (!draining) {
        setTimeout(drainQueue, 0);
    }
};

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],148:[function(require,module,exports){
module.exports = require("./lib/_stream_duplex.js")

},{"./lib/_stream_duplex.js":149}],149:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

module.exports = Duplex;

/*<replacement>*/
var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}
/*</replacement>*/


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

forEach(objectKeys(Writable.prototype), function(method) {
  if (!Duplex.prototype[method])
    Duplex.prototype[method] = Writable.prototype[method];
});

function Duplex(options) {
  if (!(this instanceof Duplex))
    return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false)
    this.readable = false;

  if (options && options.writable === false)
    this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false)
    this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended)
    return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  process.nextTick(this.end.bind(this));
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

}).call(this,require('_process'))
},{"./_stream_readable":151,"./_stream_writable":153,"_process":147,"core-util-is":154,"inherits":143}],150:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough))
    return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function(chunk, encoding, cb) {
  cb(null, chunk);
};

},{"./_stream_transform":152,"core-util-is":154,"inherits":143}],151:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Readable;

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/


/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Readable.ReadableState = ReadableState;

var EE = require('events').EventEmitter;

/*<replacement>*/
if (!EE.listenerCount) EE.listenerCount = function(emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

var Stream = require('stream');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var StringDecoder;

util.inherits(Readable, Stream);

function ReadableState(options, stream) {
  options = options || {};

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : 16 * 1024;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.buffer = [];
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = false;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // In streams that never have any data, and do push(null) right away,
  // the consumer can miss the 'end' event if they do some I/O before
  // consuming the stream.  So, we don't emit('end') until some reading
  // happens.
  this.calledRead = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, becuase any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;


  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder)
      StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  if (!(this instanceof Readable))
    return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function(chunk, encoding) {
  var state = this._readableState;

  if (typeof chunk === 'string' && !state.objectMode) {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = new Buffer(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function(chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (chunk === null || chunk === undefined) {
    state.reading = false;
    if (!state.ended)
      onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var e = new Error('stream.unshift() after end event');
      stream.emit('error', e);
    } else {
      if (state.decoder && !addToFront && !encoding)
        chunk = state.decoder.write(chunk);

      // update the buffer info.
      state.length += state.objectMode ? 1 : chunk.length;
      if (addToFront) {
        state.buffer.unshift(chunk);
      } else {
        state.reading = false;
        state.buffer.push(chunk);
      }

      if (state.needReadable)
        emitReadable(stream);

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}



// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended &&
         (state.needReadable ||
          state.length < state.highWaterMark ||
          state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function(enc) {
  if (!StringDecoder)
    StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
};

// Don't raise the hwm > 128MB
var MAX_HWM = 0x800000;
function roundUpToNextPowerOf2(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2
    n--;
    for (var p = 1; p < 32; p <<= 1) n |= n >> p;
    n++;
  }
  return n;
}

function howMuchToRead(n, state) {
  if (state.length === 0 && state.ended)
    return 0;

  if (state.objectMode)
    return n === 0 ? 0 : 1;

  if (n === null || isNaN(n)) {
    // only flow one buffer at a time
    if (state.flowing && state.buffer.length)
      return state.buffer[0].length;
    else
      return state.length;
  }

  if (n <= 0)
    return 0;

  // If we're asking for more than the target buffer level,
  // then raise the water mark.  Bump up to the next highest
  // power of 2, to prevent increasing it excessively in tiny
  // amounts.
  if (n > state.highWaterMark)
    state.highWaterMark = roundUpToNextPowerOf2(n);

  // don't have that much.  return null, unless we've ended.
  if (n > state.length) {
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    } else
      return state.length;
  }

  return n;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function(n) {
  var state = this._readableState;
  state.calledRead = true;
  var nOrig = n;
  var ret;

  if (typeof n !== 'number' || n > 0)
    state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 &&
      state.needReadable &&
      (state.length >= state.highWaterMark || state.ended)) {
    emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    ret = null;

    // In cases where the decoder did not receive enough data
    // to produce a full chunk, then immediately received an
    // EOF, state.buffer will contain [<Buffer >, <Buffer 00 ...>].
    // howMuchToRead will see this and coerce the amount to
    // read to zero (because it's looking at the length of the
    // first <Buffer > in state.buffer), and we'll end up here.
    //
    // This can only happen via state.decoder -- no other venue
    // exists for pushing a zero-length chunk into state.buffer
    // and triggering this behavior. In this case, we return our
    // remaining data and end the stream, if appropriate.
    if (state.length > 0 && state.decoder) {
      ret = fromList(n, state);
      state.length -= ret.length;
    }

    if (state.length === 0)
      endReadable(this);

    return ret;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;

  // if we currently have less than the highWaterMark, then also read some
  if (state.length - n <= state.highWaterMark)
    doRead = true;

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading)
    doRead = false;

  if (doRead) {
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0)
      state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
  }

  // If _read called its callback synchronously, then `reading`
  // will be false, and we need to re-evaluate how much data we
  // can return to the user.
  if (doRead && !state.reading)
    n = howMuchToRead(nOrig, state);

  if (n > 0)
    ret = fromList(n, state);
  else
    ret = null;

  if (ret === null) {
    state.needReadable = true;
    n = 0;
  }

  state.length -= n;

  // If we have nothing in the buffer, then we want to know
  // as soon as we *do* get something into the buffer.
  if (state.length === 0 && !state.ended)
    state.needReadable = true;

  // If we happened to read() exactly the remaining amount in the
  // buffer, and the EOF has been seen at this point, then make sure
  // that we emit 'end' on the very next tick.
  if (state.ended && !state.endEmitted && state.length === 0)
    endReadable(this);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!Buffer.isBuffer(chunk) &&
      'string' !== typeof chunk &&
      chunk !== null &&
      chunk !== undefined &&
      !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}


function onEofChunk(stream, state) {
  if (state.decoder && !state.ended) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // if we've ended and we have some data left, then emit
  // 'readable' now to make sure it gets picked up.
  if (state.length > 0)
    emitReadable(stream);
  else
    endReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (state.emittedReadable)
    return;

  state.emittedReadable = true;
  if (state.sync)
    process.nextTick(function() {
      emitReadable_(stream);
    });
  else
    emitReadable_(stream);
}

function emitReadable_(stream) {
  stream.emit('readable');
}


// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    process.nextTick(function() {
      maybeReadMore_(stream, state);
    });
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended &&
         state.length < state.highWaterMark) {
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;
    else
      len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function(n) {
  this.emit('error', new Error('not implemented'));
};

Readable.prototype.pipe = function(dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;

  var doEnd = (!pipeOpts || pipeOpts.end !== false) &&
              dest !== process.stdout &&
              dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted)
    process.nextTick(endFn);
  else
    src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    if (readable !== src) return;
    cleanup();
  }

  function onend() {
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  function cleanup() {
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (!dest._writableState || dest._writableState.needDrain)
      ondrain();
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    unpipe();
    dest.removeListener('error', onerror);
    if (EE.listenerCount(dest, 'error') === 0)
      dest.emit('error', er);
  }
  // This is a brutally ugly hack to make sure that our error handler
  // is attached before any userland ones.  NEVER DO THIS.
  if (!dest._events || !dest._events.error)
    dest.on('error', onerror);
  else if (isArray(dest._events.error))
    dest._events.error.unshift(onerror);
  else
    dest._events.error = [onerror, dest._events.error];



  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    // the handler that waits for readable events after all
    // the data gets sucked out in flow.
    // This would be easier to follow with a .once() handler
    // in flow(), but that is too slow.
    this.on('readable', pipeOnReadable);

    state.flowing = true;
    process.nextTick(function() {
      flow(src);
    });
  }

  return dest;
};

function pipeOnDrain(src) {
  return function() {
    var dest = this;
    var state = src._readableState;
    state.awaitDrain--;
    if (state.awaitDrain === 0)
      flow(src);
  };
}

function flow(src) {
  var state = src._readableState;
  var chunk;
  state.awaitDrain = 0;

  function write(dest, i, list) {
    var written = dest.write(chunk);
    if (false === written) {
      state.awaitDrain++;
    }
  }

  while (state.pipesCount && null !== (chunk = src.read())) {

    if (state.pipesCount === 1)
      write(state.pipes, 0, null);
    else
      forEach(state.pipes, write);

    src.emit('data', chunk);

    // if anyone needs a drain, then we have to wait for that.
    if (state.awaitDrain > 0)
      return;
  }

  // if every destination was unpiped, either before entering this
  // function, or in the while loop, then stop flowing.
  //
  // NB: This is a pretty rare edge case.
  if (state.pipesCount === 0) {
    state.flowing = false;

    // if there were data event listeners added, then switch to old mode.
    if (EE.listenerCount(src, 'data') > 0)
      emitDataEvents(src);
    return;
  }

  // at this point, no one needed a drain, so we just ran out of data
  // on the next readable event, start it over again.
  state.ranOut = true;
}

function pipeOnReadable() {
  if (this._readableState.ranOut) {
    this._readableState.ranOut = false;
    flow(this);
  }
}


Readable.prototype.unpipe = function(dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0)
    return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes)
      return this;

    if (!dest)
      dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    this.removeListener('readable', pipeOnReadable);
    state.flowing = false;
    if (dest)
      dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    this.removeListener('readable', pipeOnReadable);
    state.flowing = false;

    for (var i = 0; i < len; i++)
      dests[i].emit('unpipe', this);
    return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1)
    return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1)
    state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function(ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  if (ev === 'data' && !this._readableState.flowing)
    emitDataEvents(this);

  if (ev === 'readable' && this.readable) {
    var state = this._readableState;
    if (!state.readableListening) {
      state.readableListening = true;
      state.emittedReadable = false;
      state.needReadable = true;
      if (!state.reading) {
        this.read(0);
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function() {
  emitDataEvents(this);
  this.read(0);
  this.emit('resume');
};

Readable.prototype.pause = function() {
  emitDataEvents(this, true);
  this.emit('pause');
};

function emitDataEvents(stream, startPaused) {
  var state = stream._readableState;

  if (state.flowing) {
    // https://github.com/isaacs/readable-stream/issues/16
    throw new Error('Cannot switch to old mode now.');
  }

  var paused = startPaused || false;
  var readable = false;

  // convert to an old-style stream.
  stream.readable = true;
  stream.pipe = Stream.prototype.pipe;
  stream.on = stream.addListener = Stream.prototype.on;

  stream.on('readable', function() {
    readable = true;

    var c;
    while (!paused && (null !== (c = stream.read())))
      stream.emit('data', c);

    if (c === null) {
      readable = false;
      stream._readableState.needReadable = true;
    }
  });

  stream.pause = function() {
    paused = true;
    this.emit('pause');
  };

  stream.resume = function() {
    paused = false;
    if (readable)
      process.nextTick(function() {
        stream.emit('readable');
      });
    else
      this.read(0);
    this.emit('resume');
  };

  // now make it start, just in case it hadn't already.
  stream.emit('readable');
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function(stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function() {
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length)
        self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function(chunk) {
    if (state.decoder)
      chunk = state.decoder.write(chunk);

    // don't skip over falsy values in objectMode
    //if (state.objectMode && util.isNullOrUndefined(chunk))
    if (state.objectMode && (chunk === null || chunk === undefined))
      return;
    else if (!state.objectMode && (!chunk || !chunk.length))
      return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (typeof stream[i] === 'function' &&
        typeof this[i] === 'undefined') {
      this[i] = function(method) { return function() {
        return stream[method].apply(stream, arguments);
      }}(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function(ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function(n) {
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};



// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
function fromList(n, state) {
  var list = state.buffer;
  var length = state.length;
  var stringMode = !!state.decoder;
  var objectMode = !!state.objectMode;
  var ret;

  // nothing in the list, definitely empty.
  if (list.length === 0)
    return null;

  if (length === 0)
    ret = null;
  else if (objectMode)
    ret = list.shift();
  else if (!n || n >= length) {
    // read it all, truncate the array.
    if (stringMode)
      ret = list.join('');
    else
      ret = Buffer.concat(list, length);
    list.length = 0;
  } else {
    // read just some of it.
    if (n < list[0].length) {
      // just take a part of the first list item.
      // slice is the same for buffers and strings.
      var buf = list[0];
      ret = buf.slice(0, n);
      list[0] = buf.slice(n);
    } else if (n === list[0].length) {
      // first list is a perfect match
      ret = list.shift();
    } else {
      // complex case.
      // we have enough to cover it, but it spans past the first buffer.
      if (stringMode)
        ret = '';
      else
        ret = new Buffer(n);

      var c = 0;
      for (var i = 0, l = list.length; i < l && c < n; i++) {
        var buf = list[0];
        var cpy = Math.min(n - c, buf.length);

        if (stringMode)
          ret += buf.slice(0, cpy);
        else
          buf.copy(ret, c, 0, cpy);

        if (cpy < buf.length)
          list[0] = buf.slice(cpy);
        else
          list.shift();

        c += cpy;
      }
    }
  }

  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0)
    throw new Error('endReadable called on non-empty stream');

  if (!state.endEmitted && state.calledRead) {
    state.ended = true;
    process.nextTick(function() {
      // Check that we didn't get one last unshift.
      if (!state.endEmitted && state.length === 0) {
        state.endEmitted = true;
        stream.readable = false;
        stream.emit('end');
      }
    });
  }
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf (xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}

}).call(this,require('_process'))
},{"_process":147,"buffer":"buffer","core-util-is":154,"events":142,"inherits":143,"isarray":144,"stream":159,"string_decoder/":160}],152:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.


// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);


function TransformState(options, stream) {
  this.afterTransform = function(er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb)
    return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (data !== null && data !== undefined)
    stream.push(data);

  if (cb)
    cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}


function Transform(options) {
  if (!(this instanceof Transform))
    return new Transform(options);

  Duplex.call(this, options);

  var ts = this._transformState = new TransformState(options, this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  this.once('finish', function() {
    if ('function' === typeof this._flush)
      this._flush(function(er) {
        done(stream, er);
      });
    else
      done(stream);
  });
}

Transform.prototype.push = function(chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function(chunk, encoding, cb) {
  throw new Error('not implemented');
};

Transform.prototype._write = function(chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform ||
        rs.needReadable ||
        rs.length < rs.highWaterMark)
      this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function(n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};


function done(stream, er) {
  if (er)
    return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var rs = stream._readableState;
  var ts = stream._transformState;

  if (ws.length)
    throw new Error('calling transform done when ws.length != 0');

  if (ts.transforming)
    throw new Error('calling transform done when still transforming');

  return stream.push(null);
}

},{"./_stream_duplex":149,"core-util-is":154,"inherits":143}],153:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// A bit simpler than readable streams.
// Implement an async ._write(chunk, cb), and it'll handle all
// the drain event emission and buffering.

module.exports = Writable;

/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Writable.WritableState = WritableState;


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Stream = require('stream');

util.inherits(Writable, Stream);

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
}

function WritableState(options, stream) {
  options = options || {};

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : 16 * 1024;

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, becuase any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function(er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.buffer = [];

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;
}

function Writable(options) {
  var Duplex = require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable) && !(this instanceof Duplex))
    return new Writable(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function() {
  this.emit('error', new Error('Cannot pipe. Not readable.'));
};


function writeAfterEnd(stream, state, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  process.nextTick(function() {
    cb(er);
  });
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;
  if (!Buffer.isBuffer(chunk) &&
      'string' !== typeof chunk &&
      chunk !== null &&
      chunk !== undefined &&
      !state.objectMode) {
    var er = new TypeError('Invalid non-string/buffer chunk');
    stream.emit('error', er);
    process.nextTick(function() {
      cb(er);
    });
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function(chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (Buffer.isBuffer(chunk))
    encoding = 'buffer';
  else if (!encoding)
    encoding = state.defaultEncoding;

  if (typeof cb !== 'function')
    cb = function() {};

  if (state.ended)
    writeAfterEnd(this, state, cb);
  else if (validChunk(this, state, chunk, cb))
    ret = writeOrBuffer(this, state, chunk, encoding, cb);

  return ret;
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode &&
      state.decodeStrings !== false &&
      typeof chunk === 'string') {
    chunk = new Buffer(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);
  if (Buffer.isBuffer(chunk))
    encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret)
    state.needDrain = true;

  if (state.writing)
    state.buffer.push(new WriteReq(chunk, encoding, cb));
  else
    doWrite(stream, state, len, chunk, encoding, cb);

  return ret;
}

function doWrite(stream, state, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  if (sync)
    process.nextTick(function() {
      cb(er);
    });
  else
    cb(er);

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er)
    onwriteError(stream, state, sync, er, cb);
  else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(stream, state);

    if (!finished && !state.bufferProcessing && state.buffer.length)
      clearBuffer(stream, state);

    if (sync) {
      process.nextTick(function() {
        afterWrite(stream, state, finished, cb);
      });
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished)
    onwriteDrain(stream, state);
  cb();
  if (finished)
    finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}


// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;

  for (var c = 0; c < state.buffer.length; c++) {
    var entry = state.buffer[c];
    var chunk = entry.chunk;
    var encoding = entry.encoding;
    var cb = entry.callback;
    var len = state.objectMode ? 1 : chunk.length;

    doWrite(stream, state, len, chunk, encoding, cb);

    // if we didn't call the onwrite immediately, then
    // it means that we need to wait until it does.
    // also, that means that the chunk and cb are currently
    // being processed, so move the buffer counter past them.
    if (state.writing) {
      c++;
      break;
    }
  }

  state.bufferProcessing = false;
  if (c < state.buffer.length)
    state.buffer = state.buffer.slice(c);
  else
    state.buffer.length = 0;
}

Writable.prototype._write = function(chunk, encoding, cb) {
  cb(new Error('not implemented'));
};

Writable.prototype.end = function(chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (typeof chunk !== 'undefined' && chunk !== null)
    this.write(chunk, encoding);

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished)
    endWritable(this, state, cb);
};


function needFinish(stream, state) {
  return (state.ending &&
          state.length === 0 &&
          !state.finished &&
          !state.writing);
}

function finishMaybe(stream, state) {
  var need = needFinish(stream, state);
  if (need) {
    state.finished = true;
    stream.emit('finish');
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished)
      process.nextTick(cb);
    else
      stream.once('finish', cb);
  }
  state.ended = true;
}

}).call(this,require('_process'))
},{"./_stream_duplex":149,"_process":147,"buffer":"buffer","core-util-is":154,"inherits":143,"stream":159}],154:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

function isBuffer(arg) {
  return Buffer.isBuffer(arg);
}
exports.isBuffer = isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],155:[function(require,module,exports){
module.exports = require("./lib/_stream_passthrough.js")

},{"./lib/_stream_passthrough.js":150}],156:[function(require,module,exports){
var Stream = require('stream'); // hack to fix a circular dependency issue when used with browserify
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = Stream;
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

},{"./lib/_stream_duplex.js":149,"./lib/_stream_passthrough.js":150,"./lib/_stream_readable.js":151,"./lib/_stream_transform.js":152,"./lib/_stream_writable.js":153,"stream":159}],157:[function(require,module,exports){
module.exports = require("./lib/_stream_transform.js")

},{"./lib/_stream_transform.js":152}],158:[function(require,module,exports){
module.exports = require("./lib/_stream_writable.js")

},{"./lib/_stream_writable.js":153}],159:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Stream;

var EE = require('events').EventEmitter;
var inherits = require('inherits');

inherits(Stream, EE);
Stream.Readable = require('readable-stream/readable.js');
Stream.Writable = require('readable-stream/writable.js');
Stream.Duplex = require('readable-stream/duplex.js');
Stream.Transform = require('readable-stream/transform.js');
Stream.PassThrough = require('readable-stream/passthrough.js');

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream() {
  EE.call(this);
}

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EE.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":142,"inherits":143,"readable-stream/duplex.js":148,"readable-stream/passthrough.js":155,"readable-stream/readable.js":156,"readable-stream/transform.js":157,"readable-stream/writable.js":158}],160:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var Buffer = require('buffer').Buffer;

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     }


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
var StringDecoder = exports.StringDecoder = function(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
};


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

},{"buffer":"buffer"}],161:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],162:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":161,"_process":147,"inherits":143}],163:[function(require,module,exports){
var indexOf = require('indexof');

var Object_keys = function (obj) {
    if (Object.keys) return Object.keys(obj)
    else {
        var res = [];
        for (var key in obj) res.push(key)
        return res;
    }
};

var forEach = function (xs, fn) {
    if (xs.forEach) return xs.forEach(fn)
    else for (var i = 0; i < xs.length; i++) {
        fn(xs[i], i, xs);
    }
};

var defineProp = (function() {
    try {
        Object.defineProperty({}, '_', {});
        return function(obj, name, value) {
            Object.defineProperty(obj, name, {
                writable: true,
                enumerable: false,
                configurable: true,
                value: value
            })
        };
    } catch(e) {
        return function(obj, name, value) {
            obj[name] = value;
        };
    }
}());

var globals = ['Array', 'Boolean', 'Date', 'Error', 'EvalError', 'Function',
'Infinity', 'JSON', 'Math', 'NaN', 'Number', 'Object', 'RangeError',
'ReferenceError', 'RegExp', 'String', 'SyntaxError', 'TypeError', 'URIError',
'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape',
'eval', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'undefined', 'unescape'];

function Context() {}
Context.prototype = {};

var Script = exports.Script = function NodeScript (code) {
    if (!(this instanceof Script)) return new Script(code);
    this.code = code;
};

Script.prototype.runInContext = function (context) {
    if (!(context instanceof Context)) {
        throw new TypeError("needs a 'context' argument.");
    }
    
    var iframe = document.createElement('iframe');
    if (!iframe.style) iframe.style = {};
    iframe.style.display = 'none';
    
    document.body.appendChild(iframe);
    
    var win = iframe.contentWindow;
    var wEval = win.eval, wExecScript = win.execScript;

    if (!wEval && wExecScript) {
        // win.eval() magically appears when this is called in IE:
        wExecScript.call(win, 'null');
        wEval = win.eval;
    }
    
    forEach(Object_keys(context), function (key) {
        win[key] = context[key];
    });
    forEach(globals, function (key) {
        if (context[key]) {
            win[key] = context[key];
        }
    });
    
    var winKeys = Object_keys(win);

    var res = wEval.call(win, this.code);
    
    forEach(Object_keys(win), function (key) {
        // Avoid copying circular objects like `top` and `window` by only
        // updating existing context properties or new properties in the `win`
        // that was only introduced after the eval.
        if (key in context || indexOf(winKeys, key) === -1) {
            context[key] = win[key];
        }
    });

    forEach(globals, function (key) {
        if (!(key in context)) {
            defineProp(context, key, win[key]);
        }
    });
    
    document.body.removeChild(iframe);
    
    return res;
};

Script.prototype.runInThisContext = function () {
    return eval(this.code); // maybe...
};

Script.prototype.runInNewContext = function (context) {
    var ctx = Script.createContext(context);
    var res = this.runInContext(ctx);

    forEach(Object_keys(ctx), function (key) {
        context[key] = ctx[key];
    });

    return res;
};

forEach(Object_keys(Script.prototype), function (name) {
    exports[name] = Script[name] = function (code) {
        var s = Script(code);
        return s[name].apply(s, [].slice.call(arguments, 1));
    };
});

exports.createScript = function (code) {
    return exports.Script(code);
};

exports.createContext = Script.createContext = function (context) {
    var copy = new Context();
    if(typeof context === 'object') {
        forEach(Object_keys(context), function (key) {
            copy[key] = context[key];
        });
    }
    return copy;
};

},{"indexof":164}],164:[function(require,module,exports){

var indexOf = [].indexOf;

module.exports = function(arr, obj){
  if (indexOf) return arr.indexOf(obj);
  for (var i = 0; i < arr.length; ++i) {
    if (arr[i] === obj) return i;
  }
  return -1;
};
},{}],165:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var chromeNet = require('chrome-net');

exports.connect = function connect(options, cb) {
  function connectionListener() {
    /* jshint validthis:true */
    this.setNoDelay(true);
    if (typeof cb === 'function') {
      cb.apply(this, arguments);
    }
  }
  return chromeNet.connect(options, connectionListener);
};
exports._connect = chromeNet.connect;
},{"chrome-net":244}],166:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('./util');
var EventEmitter = require('events').EventEmitter;
var protocol = require('./protocol');
var Connection = protocol.Connection;
var Result = protocol.Result;
var Statement = protocol.Statement;

module.exports = Client;

util.inherits(Client, EventEmitter);

function Client(options) {
  EventEmitter.call(this);

  this._settings = util.extend({
    fetchSize: 1024,
    holdCursorsOverCommit: true,
    scrollableCursor: true,
    autoReconnect: false
  }, options);
  this._connection = this._createConnection(this._settings);
  this._addListeners(this._connection);
}

Object.defineProperties(Client.prototype, {
  connectOptions: {
    get: function getConnectOptions() {
      return this._connection.connectOptions;
    }
  },
  clientId: {
    get: function getClientId() {
      return this._connection.clientId;
    }
  },
  readyState: {
    get: function getreadyState() {
      return this._connection.readyState;
    }
  }
});

Client.prototype.setAutoCommit = function setAutoCommit(autoCommit) {
  this._connection.autoCommit = autoCommit;
};

Client.prototype.commit = function commit(cb) {
  function done(err, reply) {
    if (util.isFunction(cb)) {
      if (err) {
        return cb(err);
      }
      if (util.isObject(reply.transactionFlags) && !reply.transactionFlags.committed) {
        err = new Error('Commit has not been confirmed by the server');
        err.code = 'EHDBCOMMIT';
        return cb(err);
      }
      cb(null);
    }
  }
  this._connection.commit(done);
};

Client.prototype.rollback = function rollback(cb) {
  function done(err, reply) {
    if (util.isFunction(cb)) {
      if (err) {
        return cb(err);
      }
      if (util.isObject(reply.transactionFlags) && !reply.transactionFlags.rolledBack) {
        err = new Error('Rollback has not been confirmed by the server');
        err.code = 'EHDBROLLBACK';
        return cb(err);
      }
      cb(null);
    }
  }
  this._connection.rollback(done);
};

Client.prototype.get = function (key) {
  if (util.isUndefined(key)) {
    return this._settings;
  }
  return this._settings[key];
};

Client.prototype.set = function (key, value) {
  if (!value && util.isObject(key)) {
    this._settings = util.extend(this._settings, key);
  } else {
    this._settings[key] = value;
  }
  return this;
};

Client.prototype.connect = function connect(options, cb) {
  if (util.isFunction(options)) {
    cb = options;
    options = {};
  }

  var settings = this._settings;

  function addOption(name) {
    /* jshint validthis:true */
    if (name in settings) {
      this[name] = settings[name];
    }
  }

  var openOptions = {
    host: settings.host,
    port: settings.port
  };
  ['pfx', 'key', 'cert', 'ca', 'passphrase', 'rejectUnauthorized',
    'secureProtocol'
  ].forEach(addOption, openOptions);
  util.extend(openOptions, options);

  var connectOptions = {};
  ['user', 'password', 'assertion', 'sessionCookie'].forEach(addOption,
    connectOptions);
  util.extend(connectOptions, options);

  // SAML assertion can only be used once
  if (this._settings.assertion) {
    this._settings.assertion = undefined;
  }

  var self = this;

  function done(err) {
    if (!err) {
      self.emit('connect');
    }
    if (util.isFunction(cb)) {
      cb(err);
    }
  }

  function onopen(err) {
    if (err) {
      return done(err);
    }
    self._connection.connect(connectOptions, done);
  }

  if (this._connection.readyState === 'new') {
    this._connection.open(openOptions, onopen);
  } else if (this._connection.readyState === 'closed') {
    this._connection = this._createConnection(this._settings);
    this._addListeners(this._connection);
    this._connection.open(openOptions, onopen);
  } else if (this._connection.readyState === 'disconnected') {
    this._connection.connect(connectOptions, done);
  } else {
    if (util.isFunction(cb)) {
      util.setImmediate(function deferError() {
        var msg = util.format('Cannot connect in state "%s"', self.readyState);
        var err = new Error(msg);
        err.code = 'EHDBCONNECT';
        cb(err);
      });
    }
  }
  return this;
};

Client.prototype.disconnect = function disconnect(cb) {
  var self = this;

  function done(err) {
    if (!err) {
      self.emit('disconnect');
    }
    if (util.isFunction(cb)) {
      cb(err);
    }
  }
  this._connection.disconnect(done);
  return this;
};

Client.prototype.close = function close() {
  this._connection.close();
};
Client.prototype.end = Client.prototype.close;

Client.prototype.prepare = function prepare(command, cb) {
  var options;
  if (util.isString(command)) {
    options = {
      command: command
    };
  } else if (util.isObject(command)) {
    options = command;
  }

  var statement = new Statement(this._connection);
  this._connection.prepare(options, function onreply(err, reply) {
    statement.handle(err, reply, cb);
  });
  return this;
};

Client.prototype.destroy = function destroy(err) {
  this._connection.destroy(err);
};

Client.prototype.exec = function exec(command, options, cb) {
  var defaults = {
    autoFetch: true
  };
  executeDirect.call(this, defaults, command, options, cb);
  return this;
};

Client.prototype.execute = function execute(command, options, cb) {
  var defaults = {
    autoFetch: false
  };
  executeDirect.call(this, defaults, command, options, cb);
  return this;
};

Client.prototype._createConnection = function _createConnection(settings) {
  return new Connection(settings);
};

Client.prototype._addListeners = function _addListeners(connection) {
  var self = this;

  function cleanup() {
    connection.removeListener('error', onerror);
    connection.removeListener('close', onclose);
  }

  function onerror(err) {
    self.emit('error', err);
  }
  connection.on('error', onerror);

  function onclose(hadError) {
    cleanup();
    self.emit('close', hadError);
    if (hadError && self.get('autoReconnect')) {
      self.connect();
    }
  }
  connection.on('close', onclose);
};

Client.prototype._createResult = function _createResult(connection, options) {
  return new Result(connection, options);
};

function executeDirect(defaults, command, options, cb) {
  /* jshint validthis: true */
  if (util.isFunction(options)) {
    cb = options;
    options = defaults;
  } else if (util.isObject(options)) {
    options = util.extend(defaults, options);
  } else {
    var autoFetch = !!options;
    options = defaults;
    options.autoFetch = autoFetch;
  }
  var executeOptions = {
    command: command,
  };
  var result = this._createResult(this._connection, options);

  function onreply(err, reply) {
    result.handle(err, reply, cb);
  }
  this._connection.executeDirect(executeOptions, onreply);
}
},{"./protocol":228,"./util":242,"events":142}],167:[function(require,module,exports){
(function (process,Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var os = require('os');
var EventEmitter = require('events').EventEmitter;
var tcp = require('./tcp');
var auth = require('./auth');
var util = require('../util');
var Transaction = require('./Transaction');
var common = require('./common');
var request = require('./request');
var reply = require('./reply');
var createExecuteTask = require('./ExecuteTask').create;
var ReplySegment = reply.Segment;
var part = require('./part');
var MessageType = common.MessageType;
var MessageTypeName = common.MessageTypeName;
var SegmentKind = common.SegmentKind;
var PartKind = common.PartKind;
var bignum = util.bignum;
var debug = util.debuglog('hdb');
var trace = util.tracelog();

var MAX_PACKET_SIZE = common.MAX_PACKET_SIZE;
var PACKET_HEADER_LENGTH = common.PACKET_HEADER_LENGTH;
var SEGMENT_HEADER_LENGTH = common.SEGMENT_HEADER_LENGTH;
var PART_HEADER_LENGTH = common.PART_HEADER_LENGTH;
var MAX_AVAILABLE_SIZE = MAX_PACKET_SIZE -
  PACKET_HEADER_LENGTH - SEGMENT_HEADER_LENGTH - PART_HEADER_LENGTH;

module.exports = Connection;

util.inherits(Connection, EventEmitter);

function Connection(settings) {
  EventEmitter.call(this);

  var self = this;
  // public
  this.clientId = [process.pid || 'nodejs', os.hostname()].join('@');
  this.connectOptions = new part.ConnectOptions();
  this.protocolVersion = undefined;
  // private
  this._settings = settings || {};
  this._socket = undefined;
  this._queue = new util.Queue().pause();
  this._state = new ConnectionState();
  this._statementContext = undefined;
  this._transaction = new Transaction();
  this._transaction.once('error', function onerror(err) {
    self.destroy(err);
  });
}

Object.defineProperties(Connection.prototype, {
  autoCommit: {
    get: function getAutoCommit() {
      return this._transaction.autoCommit;
    },
    set: function setAutoCommit(autoCommit) {
      this._transaction.setAutoCommit(autoCommit);
    }
  },
  holdCursorsOverCommit: {
    get: function getHoldCursorsOverCommit() {
      return !!this._settings.holdCursorsOverCommit;
    },
    set: function setHoldCursorsOverCommit(holdCursorsOverCommit) {
      this._settings.holdCursorsOverCommit = holdCursorsOverCommit;
    }
  },
  scrollableCursor: {
    get: function setScrollableCursor() {
      return !!this._settings.scrollableCursor;
    },
    set: function setScrollableCursor(scrollableCursor) {
      this._settings.scrollableCursor = scrollableCursor;
    }
  },
  readyState: {
    get: function getReadyState() {
      // no state ==> socket must be closed
      if (!this._state) {
        return 'closed';
      }
      // no socket ==> open has not been called
      if (!this._socket) {
        return 'new';
      }
      // socket is closed ==> socket ended but not closed
      if (this._socket.readyState === 'closed') {
        return 'closed';
      }
      // no protocol version ==> open not yet finished
      if (!this.protocolVersion) {
        return 'opening';
      }
      switch (this._state.messageType) {
      case MessageType.AUTHENTICATE:
      case MessageType.CONNECT:
        return 'connecting';
      case MessageType.DISCONNECT:
        return 'disconnecting';
      }
      if (this._state.sessionId === -1) {
        return 'disconnected';
      }
      return 'connected';
    }
  }
});

Connection.prototype.open = function open(options, cb) {
  var self = this;

  if (this._socket) {
    util.setImmediate(function deferError() {
      cb(new Error('Call open only once'));
    });
    return;
  }

  function done(err, protocolVersion) {
    if (err) {
      return cb(err);
    }
    self.protocolVersion = protocolVersion;
    self._addListeners(self._socket);
    self.emit('open');
    cb();
  }
  this._socket = this._connect(options, done);
};

Connection.prototype._connect = function _connect(options, cb) {
  var socket = tcp.connect(options, function connectListener() {
    socket.write(initializationRequestBuffer);
  });

  function cleanup() {
    socket.removeListener('error', onerror);
    socket.removeListener('data', ondata);
  }

  function onerror(err) {
    cleanup();
    cb(err);
  }
  socket.on('error', onerror);

  function ondata(chunk) {
    cleanup();
    if (!chunk || chunk.length < InitializationReply.LENGTH) {
      var err = new Error('Invalid initialization reply');
      err.code = 'EHDBINIT';
      return cb(err);
    }
    var reply = InitializationReply.read(chunk, 0);
    cb(null, reply.protocolVersion);
  }
  socket.on('data', ondata);

  return socket;
};

Connection.prototype._addListeners = function _addListeners(socket) {
  var self = this;
  var packet = new MessageBuffer();

  function cleanup() {
    socket.removeListener('error', onerror);
    socket.removeListener('data', ondata);
    socket.removeListener('close', onclose);
  }

  // register listerners on socket
  function ondata(chunk) {
    packet.push(chunk);
    if (packet.isReady()) {
      if (self._state.sessionId !== packet.header.sessionId) {
        self._state.sessionId = packet.header.sessionId;
        self._state.packetCount = -1;
      }
      var buffer = packet.getData();
      packet.clear();
      var cb = self._state.receive;
      self._state.receive = undefined;
      self._state.messageType = undefined;
      self.receive(buffer, cb);
    }
  }
  socket.on('data', ondata);

  function onerror(err) {
    self.emit('error', err);
  }
  socket.on('error', onerror);

  function onclose(hadError) {
    cleanup();
    self._cleanup();
    self.emit('close', hadError);
  }
  socket.on('close', onclose);
};

Connection.prototype._cleanup = function _cleanup() {
  this._socket = undefined;
  this._state = undefined;
  this._queue.abort();
  this._queue = undefined;
};

Connection.prototype.send = function send(message, receive) {
  if (this._statementContext) {
    message.unshift(PartKind.STATEMENT_CONTEXT, this._statementContext.getOptions());
  }

  debug('send', message);
  trace('REQUEST', message);

  var size = MAX_PACKET_SIZE - PACKET_HEADER_LENGTH;
  var buffer = message.toBuffer(size);
  var packet = new Buffer(PACKET_HEADER_LENGTH + buffer.length);
  buffer.copy(packet, PACKET_HEADER_LENGTH);

  var state = this._state;
  state.messageType = message.type;
  state.receive = receive;
  // Increase packet count
  state.packetCount++;
  // Session identifier
  bignum.writeUInt64LE(packet, state.sessionId, 0);
  // Packet sequence number in this session
  // Packets with the same sequence number belong to one request / reply pair
  packet.writeUInt32LE(state.packetCount, 8);
  // Used space in this packet
  packet.writeUInt32LE(buffer.length, 12);
  // Total space in this packet
  packet.writeUInt32LE(size, 16);
  // Number of segments in this packet
  packet.writeUInt16LE(1, 20);
  // Filler
  packet.fill(0x00, 22, PACKET_HEADER_LENGTH);
  // Write request packet to socket
  if (this._socket) {
    this._socket.write(packet);
  }
};

Connection.prototype.setStatementContext = function setStatementContext(options) {
  if (options && options.length) {
    if (!this._statementContext) {
      this._statementContext = new part.StatementContext();
    }
    this._statementContext.setOptions(options);
  } else {
    this._statementContext = undefined;
  }
};

Connection.prototype.getAvailableSize = function getAvailableSize() {
  var availableSize = MAX_AVAILABLE_SIZE;
  if (this._statementContext) {
    availableSize -= this._statementContext.size;
  }
  return availableSize;
};

Connection.prototype.setTransactionFlags = function setTransactionFlags(flags) {
  if (flags) {
    this._transaction.setFlags(flags);
  }
};

Connection.prototype.receive = function receive(buffer, cb) {
  var error, segment, reply;
  try {
    segment = ReplySegment.create(buffer, 0);
    trace(segment.kind === SegmentKind.ERROR ? 'ERROR' : 'REPLY', segment);
    reply = segment.getReply();
    this.setStatementContext(reply.statementContext);
    this.setTransactionFlags(reply.transactionFlags);
    if (reply.kind === SegmentKind.ERROR) {
      error = reply.error;
    } else if (this._transaction.error) {
      error = this._transaction.error;
    }
    debug('receive', reply);
  } catch (exception) {
    error = exception;
    error.code = 'EHDBMSGPARSE';
    debug('receive', error);
  }
  if (error && error.fatal) {
    this.destroy(error);
  }
  if (util.isFunction(cb)) {
    cb(error, reply);
  }
};

Connection.prototype.enqueue = function enqueue(task, cb) {
  var queueable;
  if (util.isFunction(task)) {
    queueable = this._queue.createTask(task, cb);
    queueable.name = task.name;
  } else if (util.isObject(task)) {
    if (task instanceof request.Segment) {
      task = this.send.bind(this, task);
      queueable = this._queue.createTask(task, cb);
      queueable.name = MessageTypeName[task.type];
    } else if (util.isFunction(task.run)) {
      queueable = task;
    }
  }
  if (queueable) {
    this._queue.push(queueable);
  }
};

Connection.prototype.connect = function connect(options, cb) {
  var self = this;

  var manager;
  try {
    manager = auth.createManager(options);
  } catch (err) {
    return util.setImmediate(function deferError() {
      cb(err);
    });
  }

  function connReceive(err, reply) {
    if (err) {
      return cb(err);
    }
    if (util.isArray(reply.connectOptions)) {
      self.connectOptions.setOptions(reply.connectOptions);
    }
    manager.finalize(reply.authentication);
    self._settings.user = manager.userFromServer;
    if (manager.sessionCookie) {
      self._settings.sessionCookie = manager.sessionCookie;
    }
    self._queue.resume();
    cb(null, reply);
  }

  function authReceive(err, reply) {
    if (err) {
      return cb(err);
    }
    try {
      manager.initialize(reply.authentication);
    } catch (err) {
      return cb(err);
    }
    self.send(request.connect({
      authentication: manager.finalData(),
      clientId: self.clientId,
      connectOptions: self.connectOptions.getOptions()
    }), connReceive);
  }
  this.send(request.authenticate({
    authentication: manager.initialData()
  }), authReceive);
};

Connection.prototype.disconnect = function disconnect(cb) {
  var self = this;

  function done(err, reply) {
    if (err) {
      return cb(err);
    }
    self._statementContext = undefined;
    self._state = new ConnectionState();
    cb(null, reply);
  }

  function enqueueDisconnect() {
    self.enqueue(request.disconnect(), done);
  }

  if (this._queue.empty && !this._queue.busy) {
    return enqueueDisconnect();
  }
  this._queue.once('drain', enqueueDisconnect);
};

Connection.prototype.executeDirect = function executeDirect(options, cb) {
  options.autoCommit = this.autoCommit;
  options.holdCursorsOverCommit = this.holdCursorsOverCommit;
  options.scrollableCursor = this.scrollableCursor;
  this.enqueue(request.executeDirect(options), cb);
};

Connection.prototype.prepare = function prepare(options, cb) {
  options.holdCursorsOverCommit = this.holdCursorsOverCommit;
  options.scrollableCursor = this.scrollableCursor;
  this.enqueue(request.prepare(options), cb);
};

Connection.prototype.readLob = function readLob(options, cb) {
  if (options.locatorId) {
    options = {
      readLobRequest: options
    };
  }
  options.autoCommit = this.autoCommit;
  this.enqueue(request.readLob(options), cb);
};

Connection.prototype.execute = function execute(options, cb) {
  options.autoCommit = this.autoCommit;
  options.holdCursorsOverCommit = this.holdCursorsOverCommit;
  options.scrollableCursor = this.scrollableCursor;
  if (!options.parameters) {
    return this.enqueue(request.execute({
      autoCommit: this.autoCommit,
      holdCursorsOverCommit: this.holdCursorsOverCommit,
      scrollableCursor: this.scrollableCursor,
      statementId: options.statementId,
      parameters: new Buffer(0)
    }), cb);
  }
  this.enqueue(createExecuteTask(this, options, cb));
};

Connection.prototype.fetchNext = function fetchNext(options, cb) {
  options.autoCommit = this.autoCommit;
  this.enqueue(request.fetchNext(options), cb);
};

Connection.prototype.closeResultSet = function closeResultSet(options, cb) {
  this.enqueue(request.closeResultSet(options), cb);
};

Connection.prototype.dropStatement = function dropStatement(options, cb) {
  this.enqueue(request.dropStatementId(options), cb);
};

Connection.prototype.commit = function commit(options, cb) {
  if (util.isFunction(options)) {
    cb = options;
    options = {};
  }
  this.enqueue(request.commit(options), cb);
};

Connection.prototype.rollback = function rollback(options, cb) {
  if (util.isFunction(options)) {
    cb = options;
    options = {};
  }
  this.enqueue(request.rollback(options), cb);
};

Connection.prototype.close = function close() {
  var self = this;

  function closeConnection() {
    debug('close');
    self.destroy();
  }
  if (this._queue.empty && !this._queue.busy) {
    return closeConnection();
  }
  this._queue.once('drain', closeConnection);
};

Connection.prototype.destroy = function destroy(err) {
  if (this._socket) {
    this._socket.destroy(err);
  }
};

Connection.prototype.setAutoCommit = function setAutoCommit(autoCommit) {
  this._transaction.autoCommit = autoCommit;
};

function ConnectionState() {
  this.sessionId = -1;
  this.packetCount = -1;
  this.messageType = undefined;
  this.receive = undefined;
}

function Version(major, minor) {
  this.major = major;
  this.minor = minor;
}

Version.read = function readVersion(buffer, offset) {
  return new Version(
    buffer.readInt8(offset),
    buffer.readInt16LE(offset + 1)
  );
};

function InitializationReply(productVersion, protocolVersion) {
  this.productVersion = productVersion;
  this.protocolVersion = protocolVersion;
}

InitializationReply.LENGTH = 8;

InitializationReply.read = function readInitializationReply(buffer) {
  var productVersion = Version.read(buffer, 0);
  var protocolVersion = Version.read(buffer, 3);
  return new InitializationReply(productVersion, protocolVersion);
};

var initializationRequestBuffer = new Buffer([
  0xff, 0xff, 0xff, 0xff, 4, 20, 0x00, 4, 1, 0x00, 0x00, 1, 1, 1
]);

function MessageBuffer() {
  this.length = 0;
  this.header = undefined;
  this.data = undefined;
}

MessageBuffer.prototype.isReady = function () {
  return this.header && this.length >= this.header.length;
};

MessageBuffer.prototype.push = function push(chunk) {
  if (!chunk || !chunk.length) {
    return;
  }
  this.length += chunk.length;
  if (!this.data) {
    this.data = chunk;
  } else if (Buffer.isBuffer(this.data)) {
    this.data = [this.data, chunk];
  } else {
    this.data.push(chunk);
  }
  if (!this.header && this.length >= PACKET_HEADER_LENGTH) {
    this.readHeader();
  }
};

MessageBuffer.prototype.getData = function getData() {
  if (util.isArray(this.data)) {
    return Buffer.concat(this.data, this.length);
  }
  return this.data;
};

MessageBuffer.prototype.readHeader = function readHeader() {
  var buffer = this.getData();
  this.header = {
    sessionId: bignum.readUInt64LE(buffer, 0),
    packetCount: buffer.readUInt32LE(8),
    length: buffer.readUInt32LE(12)
  };
  this.data = buffer.slice(PACKET_HEADER_LENGTH);
  this.length -= PACKET_HEADER_LENGTH;
};

MessageBuffer.prototype.clear = function clear() {
  this.length = 0;
  this.header = undefined;
  this.data = undefined;
};
}).call(this,require('_process'),require("buffer").Buffer)
},{"../util":242,"./ExecuteTask":168,"./Transaction":177,"./auth":183,"./common":210,"./part":232,"./reply":235,"./request":238,"./tcp":165,"_process":147,"buffer":"buffer","events":142,"os":145}],168:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../util');
var request = require('./request');
var Writer = require('./Writer');
var common = require('./common');
var FunctionCode = common.FunctionCode;

var STATEMENT_ID_PART_LENGTH = 24;

exports = module.exports = ExecuteTask;

function ExecuteTask(connection, options, callback) {
  this.connection = connection;
  this.autoCommit = options.autoCommit;
  this.needFinializeTransaction = false;
  this.holdCursorsOverCommit = options.holdCursorsOverCommit;
  this.scrollableCursor = options.scrollableCursor;
  this.statementId = options.statementId;
  this.functionCode = options.functionCode;
  this.writer = new Writer(options.parameters.types);
  var values = options.parameters.values;
  if (values.length && util.isArray(values[0])) {
    this.parameterValues = values;
  } else {
    this.parameterValues = [values];
  }
  this.callback = callback;
  this.reply = undefined;
}

exports.create = function createExecuteTask(connection, options, cb) {
  return new ExecuteTask(connection, options, cb);
};

ExecuteTask.prototype.run = function run(next) {
  var self = this;

  function done(err) {
    self.end(err);
    next();
  }

  function finalize(err) {
    if (!self.needFinializeTransaction) {
      return done(err);
    }
    if (err) {
      return self.sendRollback(function () {
        // ignore roolback error
        done(err);
      });
    }
    self.sendCommit(done);
  }

  function execute() {
    if (!self.parameterValues.length) {
      return finalize();
    }
    self.sendExecute(function receive(err, reply) {
      if (err) {
        return finalize(err);
      }
      self.pushReply(reply);
      if (!self.writer.finished && reply.writeLobReply) {
        self.writer.update(reply.writeLobReply);
      }
      writeLob();
    });
  }

  function writeLob() {
    if (self.writer.finished || self.writer.hasParameters) {
      return execute();
    }
    self.sendWriteLobRequest(function receive(err, reply) {
      /* jshint unused:false */
      if (err) {
        return finalize(err);
      }
      writeLob();
    });
  }

  // validate function code
  if (self.parameterValues.length > 1) {
    switch (self.functionCode) {
    case FunctionCode.DDL:
    case FunctionCode.INSERT:
    case FunctionCode.UPDATE:
    case FunctionCode.DELETE:
      break;
    default:
      return done(createInvalidFunctionCodeError());
    }
  }

  execute();
};

ExecuteTask.prototype.end = function end(err) {
  this.callback(err, this.reply);
};

ExecuteTask.prototype.pushReply = function pushReply(reply) {
  if (!this.reply) {
    this.reply = reply;
    return;
  }
  if (reply.rowsAffected) {
    if (this.reply.rowsAffected) {
      this.reply.rowsAffected = [].concat(
        this.reply.rowsAffected, reply.rowsAffected);
    } else {
      this.reply.rowsAffected = reply.rowsAffected;
    }
  }
};

ExecuteTask.prototype.getParameters = function getParameters(availableSize, cb) {
  var self = this;
  var bytesWritten = 0;
  var args = [];

  function handleParameters(err, buffer) {
    if (err) {
      return cb(err);
    }
    bytesWritten += buffer.length;
    args.push(buffer);
    if (!self.writer.finished) {
      if (self.autoCommit) {
        self.needFinializeTransaction = true;
        self.autoCommit = false;
      }
      return cb(null, args);
    }
    next();
  }

  function next() {
    if (!self.parameterValues.length) {
      return cb(null, args);
    }
    if (!self.writer.hasParameters) {
      try {
        self.writer.setValues(self.parameterValues.shift());
      } catch (err) {
        return cb(err);
      }
    }
    var remainingSize = availableSize - bytesWritten;
    if (self.writer.length > remainingSize) {
      if (self.autoCommit) {
        self.needFinializeTransaction = true;
        self.autoCommit = false;
      }
      return cb(null, args);
    }
    self.writer.getParameters(remainingSize, handleParameters);
  }

  next();
};

ExecuteTask.prototype.sendExecute = function sendExecute(cb) {
  var self = this;
  var availableSize = self.connection.getAvailableSize();
  availableSize -= STATEMENT_ID_PART_LENGTH;
  self.getParameters(availableSize, function send(err, parameters) {
    if (err) {
      return cb(err);
    }
    self.connection.send(request.execute({
      autoCommit: self.autoCommit,
      holdCursorsOverCommit: self.holdCursorsOverCommit,
      scrollableCursor: self.scrollableCursor,
      statementId: self.statementId,
      parameters: parameters
    }), cb);
  });
};

ExecuteTask.prototype.sendWriteLobRequest = function sendWriteLobRequest(cb) {
  var self = this;
  var availableSize = self.connection.getAvailableSize();
  self.writer.getWriteLobRequest(availableSize, function send(err, buffer) {
    if (err) {
      return cb(err);
    }
    self.connection.send(request.writeLob({
      writeLobRequest: buffer
    }), cb);
  });
};

ExecuteTask.prototype.sendCommit = function sendCommit(cb) {
  var self = this;
  self.connection.send(request.commit({
    holdCursorsOverCommit: self.holdCursorsOverCommit
  }), cb);
};

ExecuteTask.prototype.sendRollback = function sendRollback(cb) {
  var self = this;
  self.connection.send(request.rollback({
    holdCursorsOverCommit: self.holdCursorsOverCommit
  }), cb);
};

function createInvalidFunctionCodeError() {
  return new Error(
    'Invalid functionCode in batch execute. ' +
    'Only DDL or DML statements are supported.'
  );
}
},{"../util":242,"./Writer":178,"./common":210,"./request":238}],169:[function(require,module,exports){
(function (process,Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var debug = util.debuglog('hdb_lob');

module.exports = Lob;

util.inherits(Lob, EventEmitter);

Lob.DEFAULT_READ_SIZE = Math.pow(2, 17);
Lob.MAX_READ_SIZE = Math.pow(2, 18);

function Lob(readLob, ld, options) {
  EventEmitter.call(this);
  // public
  this.locatorId = ld.locatorId;
  this.finished = false;
  // private
  this._readLob = readLob;
  this._running = undefined;
  this._offset = 0;
  options = options || {};
  this._readSize = options.readSize || Lob.DEFAULT_READ_SIZE;
  this._data = undefined;
  if (ld.chunk) {
    this._data = ld;
  }
}

Lob.prototype.pause = function pause() {
  this._running = false;
};

Lob.prototype.resume = function resume() {
  if (this._running || this.finished) {
    return;
  }
  this._running = true;
  if (util.isObject(this._data)) {
    handleData.call(this, this._data);
    this._data = undefined;
  } else {
    sendReadLob.call(this);
  }
};

Lob.prototype.end = function end() {
  this.finished = true;
  this._running = false;
  this._connection = undefined;
  process.nextTick(emitEnd.bind(this));
};

function emitEnd() {
  /* jshint validthis:true */
  debug('emit "end"');
  this.emit('end');
}

Lob.prototype.read = function read(cb) {
  if (!util.isUndefined(this._running)) {
    var err = new Error('Lob invalid state error');
    return cb(err);
  }

  util.readData(this, cb);
};

Lob.prototype.createReadStream = function createReadStream(options) {
  if (!util.isUndefined(this._running)) {
    return null;
  }

  return util.createReadStream(this, ['error'], options);
};

function sendReadLob() {
  /* jshint validthis:true */
  debug('sendReadLob', this.locatorId);
  this._readLob({
    locatorId: this.locatorId,
    offset: this._offset + 1,
    length: this._readSize
  }, receiveData.bind(this));
}

function receiveData(err, reply) {
  /* jshint validthis:true */
  debug('receiveData()');
  if (err) {
    this._running = false;
    this.emit('error', err);
    return;
  }

  var data = reply.readLobReply;
  if (this._running) {
    handleData.call(this, data);
  } else {
    this._data = data;
  }
}

function handleData(data) {
  /* jshint validthis:true */
  var size = data.size || this._readSize;
  debug('handleData(%d)', size);
  if (Buffer.isBuffer(data.chunk)) {
    this._offset += size;
    this.emit('data', data.chunk);
  }

  if (data.isLast) {
    return this.end();
  }

  if (this._running) {
    process.nextTick(sendReadLob.bind(this));
  }
}
}).call(this,require('_process'),require("buffer").Buffer)
},{"../util":242,"_process":147,"buffer":"buffer","events":142}],170:[function(require,module,exports){
(function (process){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var common = require('./common');
var ResultSetTransform = require('./ResultSetTransform');
var Reader = require('./Reader');
var ReadFunction = common.ReadFunction;
var TypeCode = common.TypeCode;

module.exports = Parser;

function Parser(metadata, lobFactory) {
  this.metadata = metadata;
  this.lobFactory = lobFactory;
  this.honest = !!process.browser;
}

Parser.create = function createParser(metadata, lobFactory) {
  return new Parser(metadata, lobFactory);
};

Parser.parseParameters = function parseParameters(metadata, buffer) {
  return Parser.create(metadata).parseParams(buffer);
};

Parser.prototype.createParseRowFunction = function createParseRowFunction() {
  return this.createParseFunction('columnDisplayName');
};

Parser.prototype.createParseParamsFunction = function createParseParamsFunction() {
  return this.createParseFunction('name');
};

Parser.prototype.createParseFunction = function createParseFunction(name) {
  name = name || 'columnDisplayName';
  if (!this.honest) {
    return this.createEvilParseFunction(name);
  }
  return this.createHonestParseFunction(name);
};

Parser.prototype.createEvilParseFunction = function createParseFunction(name) {
  /*jshint evil:true */
  return new Function(createFunctionBody(this.metadata, name));
};

Parser.prototype.createHonestParseFunction = function createHonestParseFunction(
  name) {

  function mapColumnMetadata(column, index) {
    var arg;
    if (column.dataType === TypeCode.DECIMAL) {
      arg = column.fraction;
    }
    var key;
    if (typeof name === 'string') {
      key = column[name];
    } else {
      key = index;
    }
    return {
      key: key,
      fname: ReadFunction[column.dataType],
      arg: arg
    };
  }
  var columns = this.metadata.map(mapColumnMetadata);
  return function parseRow() {
    var column;
    var obj = {};
    for (var i = 0; i < columns.length; i++) {
      column = columns[i];
      obj[column.key] = this[column.fname](column.arg);
    }
    return obj;
  };
};

Parser.prototype.parseParams = function parseParams(buffer) {
  var reader = new Reader(buffer, this.lobFactory);
  var parseParamsFunction = this.createParseParamsFunction();
  return parseParamsFunction.call(reader);
};

Parser.prototype.parse = function parse(buffer) {
  var reader = new Reader(buffer, this.lobFactory);
  var parseRow = this.createParseRowFunction().bind(reader);
  var rows = [];
  while (reader.hasMore()) {
    rows.push(parseRow());
  }
  return rows;
};

Parser.prototype.createTransform = function createTransform(rs, options) {
  return new ResultSetTransform(this.createParseRowFunction(), rs, options);
};

function createFunctionBody(metadata, nameProperty) {

  function addParseColumnLine(column, index) {
    var fn = ReadFunction[column.dataType];
    if (column.dataType === TypeCode.DECIMAL) {
      fn += '(' + column.fraction + ')';
    } else {
      fn += '()';
    }
    var key;
    if (typeof nameProperty === 'string') {
      key = column[nameProperty];
    } else {
      key = index;
    }
    return '"' + key + '": this.' + fn;
  }
  var functionBody = 'return {\n';
  functionBody += metadata.map(addParseColumnLine).join(',\n');
  functionBody += '\n};';
  return functionBody;
}
}).call(this,require('_process'))
},{"./Reader":171,"./ResultSetTransform":174,"./common":210,"_process":147}],171:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../util');
var bignum = util.bignum;
var common = require('./common');
var LobOptions = common.LobOptions;
var LobSourceType = common.LobSourceType;

module.exports = Reader;

function Reader(buffer, lobFactoy) {
  this.buffer = buffer;
  this.offset = 0;
  this.lobFactoy = lobFactoy;
}

Reader.prototype.hasMore = function hasMore() {
  return this.offset < this.buffer.length;
};

Reader.prototype.readTinyInt = function readTinyInt() {
  if (this.buffer[this.offset++] === 0x00) {
    return null;
  }
  var value = this.buffer.readUInt8(this.offset, true);
  this.offset += 1;
  return value;
};

Reader.prototype.readSmallInt = function readSmallInt() {
  if (this.buffer[this.offset++] === 0x00) {
    return null;
  }
  var value = this.buffer.readInt16LE(this.offset, true);
  this.offset += 2;
  return value;
};

Reader.prototype.readInt = function readInt() {
  if (this.buffer[this.offset++] === 0x00) {
    return null;
  }
  var value = this.buffer.readInt32LE(this.offset, true);
  this.offset += 4;
  return value;
};

Reader.prototype.readBigInt = function readBigInt() {
  if (this.buffer[this.offset++] === 0x00) {
    return null;
  }
  var value = bignum.readInt64LE(this.buffer, this.offset);
  this.offset += 8;
  return value;
};

Reader.prototype.readString = function readString() {
  return this.readBytes('utf-8');
};

Reader.prototype.readBinary = function readBinary() {
  return this.readBytes();
};

Reader.prototype.readBytes = function readBytes(encoding) {
  var length = this.buffer[this.offset++];
  switch (length) {
  case 0xff:
    return null;
  case 0xf6:
    length = this.buffer.readInt16LE(this.offset, true);
    this.offset += 2;
    break;
  case 0xf7:
    length = this.buffer.readInt32LE(this.offset, true);
    this.offset += 4;
    break;
  }
  var value;
  if (encoding) {
    value = this.buffer.toString(encoding, this.offset, this.offset +
      length);
  } else {
    value = new Buffer(length);
    this.buffer.copy(value, 0, this.offset, this.offset + length);
  }
  this.offset += length;
  return value;
};

Reader.prototype.readDate = function readDate() {
  /* jshint bitwise:false */
  var high = this.buffer[this.offset + 1];
  // msb not set ==> null
  if (!(high & 0x80)) {
    this.offset += 4;
    return null;
  }
  var year = this.buffer[this.offset];
  this.offset += 2;
  var month = this.buffer[this.offset] + 1;
  this.offset += 1;
  var day = this.buffer[this.offset];
  this.offset += 1;
  // msb set ==> not null
  // unset msb and second most sb
  high &= 0x3f;
  year |= high << 8;
  return util.lpad4(year) + '-' +
    util.lpad2(month) + '-' +
    util.lpad2(day);
};

Reader.prototype.readTime = function readTime() {
  /* jshint bitwise:false */
  var hour = this.buffer[this.offset];
  // msb not set ==> null
  if (!(hour & 0x80)) {
    this.offset += 4;
    return null;
  }
  var min = this.buffer[this.offset + 1];
  this.offset += 2;
  var msec = this.buffer.readUInt16LE(this.offset, true);
  this.offset += 2;
  // msb set ==> not null
  // unset msb
  hour &= 0x7f;
  return util.lpad2(hour) + ':' +
    util.lpad2(min) + ':' +
    util.lpad2(msec / 1000);
};

Reader.prototype.readTimestamp = function readTimestamp() {
  var date = this.readDate();
  var time = this.readTime();
  if (date) {
    if (time) {
      return date + 'T' + time;
    }
    return date + 'T00:00:00';
  }
  if (time) {
    return '0001-01-01T' + time;
  }
  return null;
};

Reader.prototype.readDayDate = function readDayDate() {
  var value = this.buffer.readInt32LE(this.offset, true);
  this.offset += 4;
  if (value === 3652062 || value === 0) {
    return null;
  }
  return value - 1;
};

Reader.prototype.readSecondTime = function readSecondTime() {
  var value = this.buffer.readInt32LE(this.offset, true);
  this.offset += 4;
  if (value === 86402 || value === 0) {
    return null;
  }
  return value - 1;
};

Reader.prototype.readSecondDate = function readSecondDate() {
  var value = bignum.readInt64LE(this.buffer, this.offset);
  this.offset += 8;
  if (value === 315538070401 || value === 0) {
    return null;
  }
  return value - 1;
};

Reader.prototype.readLongDate = function readLongDate() {
  var value = bignum.readInt64LE(this.buffer, this.offset);
  this.offset += 8;
  if (value === '3155380704000000001' || value === 0) {
    return null;
  }
  if (typeof value === 'string') {
    var index = value.length - 7;
    return value.substring(0, index) + util.lpad7(value.substring(index) -
      1);
  } else {
    return value - 1;
  }
};

Reader.prototype.readBLob = function readBLob() {
  return this.readLob(1);
};

Reader.prototype.readCLob = function readCLob() {
  return this.readLob(2);
};

Reader.prototype.readNCLob = function readNCLob() {
  return this.readLob(3);
};

Reader.prototype.readLob = function readLob(type) {
  /* jshint bitwise:false, unused:false */
  // offset 0
  type = this.buffer[this.offset] || type;
  this.offset += 1;
  // offset 1
  var options = this.buffer[this.offset];
  this.offset += 1;
  // offset 2
  if (options & LobOptions.NULL_INDICATOR) {
    return null;
  }
  // skip 2 byte filler
  this.offset += 2;
  // offset 4
  var charLength = bignum.readInt64LE(this.buffer, this.offset);
  this.offset += 8;
  // offset 12
  var byteLength = bignum.readInt64LE(this.buffer, this.offset);
  this.offset += 8;
  // offset 20
  var locatorId = this.buffer.slice(this.offset, this.offset + 8);
  this.offset += 8;
  // offset 28
  var chunkLength = this.buffer.readInt32LE(this.offset, true);
  this.offset += 4;
  // offset 32
  var chunk = null;
  if (chunkLength > 0) {
    chunk = this.buffer.slice(this.offset, this.offset + chunkLength);
    this.offset += chunkLength;
  } else {
    chunk = new Buffer(0);
  }
  //if (!byteLength && !charLength) { return null; }
  return this.lobFactoy.createLob(new LobDescriptor(type, locatorId,
    options,
    chunk));
};

Reader.prototype.readDouble = function readDouble() {
  if (this.buffer[this.offset] === 0xff &&
    this.buffer[this.offset + 1] === 0xff &&
    this.buffer[this.offset + 2] === 0xff &&
    this.buffer[this.offset + 3] === 0xff &&
    this.buffer[this.offset + 4] === 0xff &&
    this.buffer[this.offset + 5] === 0xff &&
    this.buffer[this.offset + 6] === 0xff &&
    this.buffer[this.offset + 7] === 0xff) {
    this.offset += 8;
    return null;
  }
  var value = this.buffer.readDoubleLE(this.offset, true);
  this.offset += 8;
  return value;
};

Reader.prototype.readFloat = function readFloat() {
  if (this.buffer[this.offset] === 0xff &&
    this.buffer[this.offset + 1] === 0xff &&
    this.buffer[this.offset + 2] === 0xff &&
    this.buffer[this.offset + 3] === 0xff) {
    this.offset += 4;
    return null;
  }
  var value = this.buffer.readFloatLE(this.offset, true);
  this.offset += 4;
  return value;
};

Reader.prototype.readDecimal = function readDecimal(fraction) {
  var value;
  if (fraction > 34) {
    value = bignum.readDecFloat(this.buffer, this.offset);
  } else {
    value = bignum.readDecFixed(this.buffer, this.offset, fraction);
  }
  this.offset += 16;
  return value;
};

function LobDescriptor(type, locatorId, options, chunk) {
  this.locatorId = locatorId;
  this.options = options;
  if (Buffer.isBuffer(chunk)) {
    this.chunk = chunk;
    if (type === LobSourceType.CLOB || type === LobSourceType.NCLOB) {
      this.size = chunk.toString('utf-8').length;
    } else {
      this.size = chunk.length;
    }
  } else {
    this.chunk = undefined;
    this.size = 0;
  }
}

Object.defineProperties(LobDescriptor.prototype, {
  isLast: {
    get: function isLast() {
      /* jshint bitwise:false */
      return !!(this.options & LobOptions.LAST_DATA);
    }
  }
});
}).call(this,require("buffer").Buffer)
},{"../util":242,"./common":210,"buffer":"buffer"}],172:[function(require,module,exports){
(function (process){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../util');
var ResultSet = require('./ResultSet');
var Parser = require('./Parser');
var Lob = require('./Lob');
var common = require('./common');
var TypeCode = common.TypeCode;
var FunctionCode = common.FunctionCode;

module.exports = Result;

function Result(connection, options) {
  options = options || {};
  this._connection = connection;
  this._autoFetch = !!options.autoFetch;
  this._readSize = options.readSize || Lob.DEFAULT_READ_SIZE;
  this._resultSetMetadata = undefined;
  this._parameterMetadata = undefined;
}

Result.prototype.setResultSetMetadata = function setResultSetMetadata(
  metadata) {
  this._resultSetMetadata = metadata;
};

Result.prototype.setParameterMetadata = function setParameterMetadata(
  metadata) {
  this._parameterMetadata = metadata;
};

Result.prototype.getLobColumnNames = function getLobColumnNames() {
  if (this._parameterMetadata) {
    return this._parameterMetadata.filter(isLob).map(getColumName);
  }
  return [];
};

Result.prototype.handle = function handle(err, reply, cb) {
  if (err) {
    return cb(err);
  }

  switch (reply.functionCode) {
  case FunctionCode.SELECT:
  case FunctionCode.SELECT_FOR_UPDATE:
    this.handleQuery(cb, this.createResultSets(reply.resultSets));
    return;
  case FunctionCode.INSERT:
  case FunctionCode.UPDATE:
  case FunctionCode.DELETE:
    this.handleModify(cb, reply.rowsAffected);
    return;
  case FunctionCode.NIL:
  case FunctionCode.DDL:
    cb(null);
    return;
  case FunctionCode.DB_PROCEDURE_CALL:
  case FunctionCode.DB_PROCEDURE_CALL_WITH_RESULT:
    this.handleDBCall(cb,
      this.createOutputParameters(reply.outputParameters),
      this.createResultSets(reply.resultSets));
    return;
  default:
    err = new Error('Invalid or unsupported FunctionCode');
    cb(err);
  }
};

Result.prototype.handleModify = function handleModify(cb, rowsAffected) {
  cb(null, rowsAffected);
};

Result.prototype.handleQuery = function handleQuery(cb, resultSets) {
  function done(err, results) {
    if (err) {
      return cb(err);
    }
    var args = [null];
    Array.prototype.push.apply(args, results);
    return cb.apply(null, args);
  }

  if (!this._autoFetch) {
    return done(null, resultSets);
  }
  fetchAll(resultSets, done);
};

Result.prototype.handleDBCall = function handleDBCall(cb, params, resultSets) {
  params = params || {};

  function done(err, results) {
    if (err) {
      return cb(err);
    }
    var args = [null, params];
    Array.prototype.push.apply(args, results);
    return cb.apply(null, args);
  }

  if (!this._autoFetch) {
    return done(null, resultSets);
  }

  function fetchResults(err) {
    if (err) {
      return done(err);
    }
    fetchAll(resultSets, done);
  }

  readLobs(this.getLobColumnNames(), params, fetchResults);
};

Result.prototype.createLob = function createLob(ld, options) {
  options = util.extend({
    readSize: this._readSize
  }, options);
  var readLob = this._connection.readLob.bind(this._connection);
  return new Lob(readLob, ld, options);
};

Result.prototype.createResultSet = function createResultSet(rsd) {
  return new ResultSet(this._connection, rsd);
};

Result.prototype.createResultSets = function createResultSets(resultSets) {
  resultSets = resultSets || [];
  // handle missing resultSet metadata
  if (this._resultSetMetadata && resultSets.length) {
    if (!resultSets[0].metadata) {
      resultSets[0].metadata = this._resultSetMetadata;
    }
  }
  return resultSets.map(this.createResultSet.bind(this));
};

Result.prototype.createOutputParameters = function createOutputParameters(
  outputParameters) {
  if (this._parameterMetadata && util.isObject(outputParameters)) {
    var parser = Parser.create(this._parameterMetadata, this);
    return parser.parseParams(outputParameters.buffer);
  }
  return null;
};

function fetchAll(resultSets, cb) {
  var results = [];

  function isOpen(rs) {
    return !rs.closed;
  }

  function handleClose(err) {
    if (err) {
      // ignore errors
    }
  }

  function close(rs) {
    rs.close(handleClose);
  }

  function done(err) {
    resultSets.filter(isOpen).forEach(close);
    if (err) {
      return cb(err);
    }
    cb(null, results);
  }

  function next(i) {
    if (i === resultSets.length) {
      return done(null);
    }

    function handleFetch(err, rows) {
      if (err) {
        return done(err);
      }
      results.push(rows);
      process.nextTick(next.bind(null, i + 1));
    }
    resultSets[i].fetch(handleFetch);
  }
  next(0);
}

function readLobs(keys, params, cb) {

  function next(i) {
    if (i === keys.length) {
      return cb(null);
    }

    var name = keys[i];
    var lob = params[name];

    function processNext() {
      process.nextTick(next.bind(null, i + 1));
    }
    if (!(lob instanceof Lob)) {
      return processNext();
    }

    function handleRead(err, buffer) {
      if (err) {
        return cb(err);
      }
      params[name] = buffer;
      process.nextTick(next.bind(null, i + 1));
    }
    lob.read(handleRead);
  }
  next(0);
}

function isLob(column) {
  switch (column.dataType) {
  case TypeCode.BLOB:
  case TypeCode.LOCATOR:
  case TypeCode.CLOB:
  case TypeCode.NCLOB:
  case TypeCode.NLOCATOR:
  case TypeCode.TEXT:
    return true;
  default:
    return false;
  }
}

function getColumName(column) {
  return column.name;
}
}).call(this,require('_process'))
},{"../util":242,"./Lob":169,"./Parser":170,"./ResultSet":173,"./common":210,"_process":147}],173:[function(require,module,exports){
(function (process,Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var common = require('./common');
var Parser = require('./Parser');
var Lob = require('./Lob');
var ResultSetAttributes = common.ResultSetAttributes;
var TypeCode = common.TypeCode;
var debug = util.debuglog('hdb_rs');

module.exports = ResultSet;

util.inherits(ResultSet, EventEmitter);

ResultSet.MAX_FETCH_SIZE = Math.pow(2, 15) - 1;
ResultSet.DEFAULT_FETCH_SIZE = Math.pow(2, 10);
ResultSet.DEFAULT_ROW_LENGTH = Math.pow(2, 6);
ResultSet.DEFAULT_ARRAY_LENGTH = Math.pow(2, 8);

function ResultSet(connection, rsd) {
  EventEmitter.call(this);
  // public
  this.id = rsd.id;
  this.metadata = rsd.metadata;
  this.closed = false;
  this.finished = false;
  // private
  this._connection = connection;
  this._running = undefined;
  this._data = rsd.data;
  this._fetchSize = ResultSet.DEFAULT_FETCH_SIZE;
  this._rowLength = ResultSet.DEFAULT_ROW_LENGTH;
  this._readSize = Lob.DEFAULT_READ_SIZE;
}

ResultSet.create = function createResultSet(connection, rsd) {
  return new ResultSet(connection, rsd);
};

Object.defineProperties(ResultSet.prototype, {
  fetchSize: {
    get: function getFetchSize() {
      return this._fetchSize;
    }
  },
  averageRowLength: {
    get: function getAverageRowLength() {
      return this._rowLength;
    }
  },
  readSize: {
    get: function getReadSize() {
      return this._readSize;
    }
  }
});

ResultSet.prototype.setFetchSize = function setFetchSize(fetchSize) {
  if (fetchSize > ResultSet.MAX_FETCH_SIZE) {
    this._fetchSize = ResultSet.MAX_FETCH_SIZE;
    return;
  }
  this._fetchSize = fetchSize;
  return this;
};

ResultSet.prototype.setAverageRowLength = function setAverageRowLength(length) {
  this._rowLength = length;
  return this;
};

ResultSet.prototype.setReadSize = function setReadSize(readSize) {
  if (readSize > Lob.MAX_READ_SIZE) {
    this._readSize = Lob.MAX_READ_SIZE;
    return;
  }
  this._readSize = readSize;
  return this;
};

ResultSet.prototype.pause = function pause() {
  this._running = false;
};

ResultSet.prototype.resume = function resume() {
  if (this._running || this.finished) {
    return;
  }
  this._running = true;
  if (util.isObject(this._data)) {
    handleData.call(this, this._data);
    this._data = undefined;
  } else {
    sendFetch.call(this);
  }
};

ResultSet.prototype.close = function close(cb) {
  this.finished = true;
  sendClose.call(this, cb);
};

ResultSet.prototype.getLobColumnNames = function getLobColumnNames() {
  return this.metadata.filter(isLob).map(getColumName);
};

ResultSet.prototype.fetch = function fetch(cb) {
  var stream = this.createArrayStream();
  var collector = new util.stream.Writable({
    objectMode: true,
    highWaterMark: 16
  });
  collector.rows = [];
  collector.columns = this.getLobColumnNames();
  if (collector.columns.length) {
    collector._write = collectLobRows;
  } else {
    collector._write = collectRows;
  }

  var self = this;

  function done(err, rows) {
    stream.removeListener('error', onerror);
    collector.removeListener('finish', onfinish);
    if (!self.closed) {
      self.close(function () {
        cb(err, rows);
      });
    } else {
      cb(err, rows);
    }
  }

  function onerror(err) {
    done(err);
  }

  function onfinish() {
    /* jshint validthis:true */
    done(null, this.rows);
  }
  stream.on('error', onerror).pipe(collector).on('finish', onfinish);
};

ResultSet.prototype.createBinaryStream = function createBinaryStream(options) {
  if (!util.isUndefined(this._running)) {
    return null;
  }

  options = util.extend({
    highWaterMark: Math.floor(1.5 * this._fetchSize * this._rowLength)
  }, options);
  options.objectMode = false;
  return util.createReadStream(this, ['error', 'close'], options);
};

ResultSet.prototype.createParser = function createParser(options) {
  return Parser.create(this.metadata).createTransform(this, options);
};

ResultSet.prototype.createObjectStream = function createObjectStream(options) {
  options = util.extend({}, options);
  options.arrayMode = false;

  return util.pipe(this.createBinaryStream(), this.createParser(options));
};

ResultSet.prototype.createArrayStream = function createArrayStream(options) {
  if (util.isNumber(options) || options === true) {
    options = {
      arrayMode: options
    };
  } else if (util.isObject(options)) {
    options = util.extend({}, options);
  } else {
    options = {
      arrayMode: ResultSet.DEFAULT_ARRAY_LENGTH
    };
  }

  return util.pipe(this.createBinaryStream(), this.createParser(options));
};

ResultSet.prototype.createReadStream = function createReadStream(options) {
  options = options || {};

  if (options.objectMode === false) {
    return this.createBinaryStream(options);
  }
  if (options.arrayMode) {
    return this.createArrayStream(options);
  }
  return this.createObjectStream(options);
};

ResultSet.prototype.createLob = function createLob(ld, options) {
  options = util.extend({
    readSize: this._readSize
  }, options);
  return new Lob(sendReadLob.bind(this), ld, options);
};

function sendClose(cb) {
  /* jshint validthis:true */
  debug('sendClose');

  var self = this;

  function done(err) {
    self._connection = undefined;
    if (err) {
      debug('close failed: %s', err);
    } else {
      self.closed = true;
      emitClose.call(self);
      self.emit('close');
    }
    if (util.isFunction(cb)) {
      cb(err);
    }
  }
  this._connection.closeResultSet({
    resultSetId: this.id
  }, done);
}

function sendFetch() {
  /* jshint validthis:true */
  debug('sendFetch(%d)', this.fetchSize);
  this._connection.fetchNext({
    resultSetId: this.id,
    fetchSize: this.fetchSize
  }, receiveData.bind(this));
}

function sendReadLob(options, cb) {
  /* jshint validthis:true */
  this._connection.readLob(options, cb);
}

function receiveData(err, reply) {
  /* jshint validthis:true */
  debug('receiveData()');
  if (err) {
    this._running = false;
    debug('emit "error": %s', err);
    this.emit('error', err);
    return;
  }
  var data = reply.resultSets[0].data;
  if (this._running) {
    handleData.call(this, data);
  } else {
    this._data = data;
  }
}

function handleData(data) {
  /* jshint validthis:true */
  debug('handleData(%d)', data.argumentCount);
  if (data.argumentCount && Buffer.isBuffer(data.buffer)) {
    debug('emit "data": length=%d', data.buffer.length);
    this.emit('data', data.buffer);
  }

  if (isLast(data)) {
    this.finished = true;
    this._running = false;
    this.closed = isClosed(data);
  }

  var self = this;
  if (self.finished) {
    process.nextTick(function callEmitEnd() {
      emitEnd.call(self);
    });
    return;
  }

  process.nextTick(function callSendFetch() {
    if (self._running && !self.finished) {
      sendFetch.call(self);
    }
  });
}

function emitEnd() {
  /* jshint validthis:true */
  debug('emit "end"');
  this.emit('end');
  var self = this;
  if (this.closed) {
    process.nextTick(function callEmitClose() {
      emitClose.call(self);
    });
  }
}

function emitClose() {
  /* jshint validthis:true */
  debug('emit "close"');
  this.emit('close');
}

function isLast(data) {
  /* jshint bitwise:false */
  return !!(data.attributes & ResultSetAttributes.LAST);
}

function isClosed(data) {
  /* jshint bitwise:false */
  return !!(data.attributes & ResultSetAttributes.CLOSED);
}

function isLob(column) {
  switch (column.dataType) {
  case TypeCode.BLOB:
  case TypeCode.LOCATOR:
  case TypeCode.CLOB:
  case TypeCode.NCLOB:
  case TypeCode.NLOCATOR:
  case TypeCode.TEXT:
    return true;
  default:
    return false;
  }
}

function getColumName(column) {
  return column.columnDisplayName;
}

function collectRows(rows, encoding, done) {
  /* jshint validthis:true */
  for (var i = 0; i < rows.length; i++) {
    this.rows.push(rows[i]);
  }
  done();
}

function collectLobRows(rows, encoding, done) {
  /* jshint validthis:true */
  var self = this;
  var i = 0;

  function handleRow(err) {
    if (err) {
      return done(err);
    }
    // next row
    i += 1;
    next();
  }

  function next() {
    if (i === rows.length) {
      return done(null, rows);
    }
    util.setImmediate(collectLobRow.bind(self, rows[i], handleRow));
  }
  next();
}

function collectLobRow(row, done) {
  /* jshint validthis:true */
  var self = this;
  var i = 0;

  function receiveLob(err, buffer) {
    if (err) {
      return done(err);
    }
    // update lob
    row[self.columns[i]] = buffer;
    // next lob
    i += 1;
    next();
  }

  function next() {
    if (i === self.columns.length) {
      self.rows.push(row);
      return done(null);
    }
    var lob = row[self.columns[i]];
    if (lob === null || Buffer.isBuffer(lob)) {
      return receiveLob(null, lob);
    }
    lob.read(receiveLob);
  }
  next();
}
}).call(this,require('_process'),require("buffer").Buffer)
},{"../util":242,"./Lob":169,"./Parser":170,"./common":210,"_process":147,"buffer":"buffer","events":142}],174:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../util');
var Transform = util.stream.Transform;
var Reader = require('./Reader');

module.exports = ResultSetTransform;

util.inherits(ResultSetTransform, Transform);

function ResultSetTransform(parseRow, rs, options) {
  options = options || {};
  // private
  this._parseRow = parseRow;
  this._rs = rs;
  this._threshold = options.threshold || ResultSetTransform.DEFAULT_TRESHHOLD;
  this._arrayMode = normalizeArrayMode(options.arrayMode);
  if (this._arrayMode) {
    this._objectBuffer = new Collector(this, this._arrayMode);
  } else {
    this._objectBuffer = this;
  }
  // call Transform constructor
  options.objectMode = false;
  options.highWaterMark = options.highWaterMark || this._arrayMode ? 4 : 1024;
  Transform.call(this, options);
  this._readableState.objectMode = true;
}

ResultSetTransform.DEFAULT_TRESHHOLD = 128;


ResultSetTransform.prototype._transform = function _transform(chunk, encoding,
  done) {
  var reader = new Reader(chunk, this._rs);
  var parseRow = this._parseRow.bind(reader);
  var objectBuffer = this._objectBuffer;
  var arrayMode = this._arrayMode;
  var threshold = this._threshold;

  function run() {
    var i = 0;
    try {
      while (reader.hasMore() && i++ < threshold) {
        objectBuffer.push(parseRow());
      }
    } catch (err) {
      return done(err);
    }
    if (reader.hasMore()) {
      return util.setImmediate(run);
    }
    if (arrayMode === true) {
      objectBuffer.flush();
    }
    done();
  }
  util.setImmediate(run);
};

ResultSetTransform.prototype._flush = function _flush(done) {
  if (this._arrayMode > 1) {
    this._objectBuffer.flush();
  }
  this.push(null);
  done();
};

function Collector(readable, mode) {
  this.readable = readable;
  this.rows = [];
  this.flushLength = mode === true ? -1 : mode;
}

Object.defineProperties(Collector.prototype, {
  empty: {
    get: function isEmpty() {
      return !this.rows.length;
    }
  }
});

Collector.prototype.push = function push(row) {
  this.rows.push(row);
  if (this.rows.length === this.flushLength) {
    this.flush();
  }
};

Collector.prototype.flush = function flush() {
  if (this.rows.length) {
    this.readable.push(this.rows);
    this.rows = [];
  }
};

function normalizeArrayMode(mode) {
  /* jshint bitwise:false */
  if (util.isBoolean(mode)) {
    return mode;
  }
  mode = ~~mode;
  if (mode > 1) {
    return mode;
  }
  return false;
}
},{"../util":242,"./Reader":171}],175:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../util');
var Result = require('./Result');
var common = require('./common');
var IoType = common.IoType;
var FunctionCode = common.FunctionCode;

module.exports = Statement;

function Statement(connection) {
  // public
  this.id = undefined;
  this.functionCode = FunctionCode.NIL;
  this.parameterMetadata = undefined;
  this.resultSetMetadata = undefined;
  this.droped = false;
  // private
  this._connection = connection;
}

Statement.prototype.exec = function exec(values, options, cb) {
  var defaults = {
    autoFetch: true
  };
  executeStatement.call(this, defaults, values, options, cb);
  return this;
};

Statement.prototype.execute = function execute(values, options, cb) {
  var defaults = {
    autoFetch: false
  };
  executeStatement.call(this, defaults, values, options, cb);
  return this;
};

Statement.prototype.drop = function drop(cb) {

  function done(err) {
    /* jshint validthis:true */
    this._connection = undefined;
    if (!err) {
      this.droped = true;
    }
    if (util.isFunction(cb)) {
      cb(err);
    }
  }
  this._connection.dropStatement({
    statementId: this.id
  }, done.bind(this));
};

Statement.prototype.getParameterName = function getParameterName(i) {
  if (util.isArray(this.parameterMetadata) && i < this.parameterMetadata.length) {
    return this.parameterMetadata[i].name;
  }
};

Statement.prototype.handle = function handle(err, reply, cb) {
  if (err) {
    this._connection = undefined;
    return cb(err);
  }

  this.id = reply.statementId;
  this.functionCode = reply.functionCode;
  if (util.isArray(reply.resultSets) && reply.resultSets.length) {
    this.resultSetMetadata = reply.resultSets[0].metadata;
  }
  this.parameterMetadata = reply.parameterMetadata;
  cb(null, this);
};

Statement.prototype._normalizeInputParameters = function normalizeInputParameters(
  values) {

  var inputParameterMetadata = this.parameterMetadata.filter(isInputParameter);
  var length = inputParameterMetadata.length;
  if (!length) {
    return null;
  }

  function getDataType(metadata) {
    return metadata.dataType;
  }

  function getObjectValue(metadata) {
    if (!util.isUndefined(values[metadata.name])) {
      return values[metadata.name];
    }
    return null;
  }

  var parameters = {
    types: inputParameterMetadata.map(getDataType),
    values: undefined
  };
  if (util.isArray(values)) {
    if (!values.length) {
      throw new Error('Invalid input parameter values');
    }

    parameters.values = values;
    return parameters;
  }
  parameters.values = inputParameterMetadata.map(getObjectValue);
  return parameters;
};

Statement.prototype._createResult = function _createResult(options) {
  var result = new Result(this._connection, options);
  result.setResultSetMetadata(this.resultSetMetadata);
  result.setParameterMetadata(this.parameterMetadata.filter(isOutputParameter));
  return result;
};

function executeStatement(defaults, values, options, cb) {
  /* jshint validthis:true */
  if (util.isFunction(options)) {
    cb = options;
    options = defaults;
  } else if (util.isObject(options)) {
    options = util.extend(defaults, options);
  } else {
    var autoFetch = !!options;
    options = defaults;
    options.autoFetch = autoFetch;
  }

  var parameters;
  try {
    parameters = this._normalizeInputParameters(values);
  } catch (err) {
    return util.setImmediate(cb.bind(null, err));
  }

  var result = this._createResult(options);
  this._connection.execute({
    functionCode: this.functionCode,
    statementId: this.id,
    parameters: parameters
  }, function onreply(err, reply) {
    result.handle(err, reply, cb);
  });
}

function isInputParameter(metadata) {
  return metadata.ioType === IoType.INPUT || metadata.ioType === IoType.IN_OUT;
}

function isOutputParameter(metadata) {
  return metadata.ioType === IoType.OUTPUT || metadata.ioType === IoType.IN_OUT;
}
},{"../util":242,"./Result":172,"./common":210}],176:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../util');
var Transform = util.stream.Transform;

module.exports = Stringifier;

util.inherits(Stringifier, Transform);

function Stringifier(options) {
  options = options || {};

  Transform.call(this, options);

  this._writableState.objectMode = true;
  this._header = options.header !== undefined ? options.header : '[';
  this._footer = options.footer !== undefined ? options.footer : ']';
  this._seperator = options.seperator !== undefined ? options.seperator : ',';
  this._stringify = options.stringify || JSON.stringify;
  this._map = undefined;
  if (util.isFunction(options.map)) {
    this._map = options.map;
  }
  this._first = true;
}

Stringifier.prototype._transform = function _transform(thing, encoding, done) {
  if (util.isArray(thing) && thing.length) {
    this.push(this.transformRows(thing));
  } else {
    this.push(this.transformRow(thing));
  }
  done();
};

Stringifier.prototype._flush = function _flush(done) {
  if (this._first) {
    this.push(this._header + this._footer);
  } else {
    this.push(this._footer);
  }
  done(null);
};

Stringifier.prototype.transformRows = function transformRows(rows) {
  if (this._map) {
    rows = rows.map(this._map);
  }
  var str = this._first ? this._header : this._seperator;
  this._first = false;
  for (var i = 0; i < rows.length; i++) {
    if (i > 0) {
      str += this._seperator;
    }
    str += this._stringify(rows[i]);
  }
  return str;
};

Stringifier.prototype.transformRow = function transformRow(row) {
  if (this._map) {
    row = this._map(row);
  }
  if (this._first) {
    this._first = false;
    return this._header + this._stringify(row);
  }
  return this._seperator + this._stringify(row);
};
},{"../util":242}],177:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var ErrorLevel = require('./common/ErrorLevel');
var debug = util.debuglog('hdbtx');

module.exports = Transaction;

util.inherits(Transaction, EventEmitter);

function Transaction() {
  EventEmitter.call(this);

  this.autoCommit = true;
  this.kind = 'none';
  this.error = undefined;
}

Transaction.prototype.setAutoCommit = function setAutoCommit(autoCommit) {
  this.autoCommit = autoCommit;
};

Transaction.prototype.setFlags = function setFlags(flags) {
  debug(flags);
  if (flags.committed) {
    this.emit('end', true, this.kind);
    this.kind = 'none';
  }
  if (flags.rolledBack) {
    this.emit('end', false, this.kind);
    this.kind = 'none';
  }
  if (flags.writeTransactionStarted) {
    this.kind = 'write';
    this.emit('new', this.kind);
  }
  if (flags.noWriteTransactionStarted) {
    this.kind = 'read';
    this.emit('new', this.kind);
  }
  if (flags.sessionClosingTransactionErrror) {
    this.error = new Error(
      'A transaction error occured that implies the session must be terminated.'
    );
    this.error.code = 'EHDBTX';
    this.error.level = ErrorLevel.FATAL;
    this.error.fatal = true;
    this.emit('error', this.error);
  }
};
},{"../util":242,"./common/ErrorLevel":192,"events":142}],178:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../util');
var Readable = util.stream.Readable;
var common = require('./common');
var TypeCode = common.TypeCode;
var LobOptions = common.LobOptions;
var NormalizedTypeCode = common.NormalizedTypeCode;
var bignum = util.bignum;

exports = module.exports = Writer;

var REGEX = {
  DATE: /(\d{4})-(\d{2})-(\d{2})/,
  TIME: /(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/,
  TIMESTAMP: /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/,
  DECIMAL: /^([+-])?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/
};

function Writer(types) {
  this._types = types.map(normalizeType);
  this.reset();
}

function normalizeType(type) {
  return NormalizedTypeCode[type];
}

Writer.prototype.clear = function clear() {
  this._params = false;
  this._buffers = [];
  this._bytesWritten = 0;
  this._argumentCount = 0;
};

Writer.prototype.reset = function reset() {
  this._lobs = [];
  this.clear();
};

Writer.prototype.setValues = function setValues(values) {
  this.reset();
  for (var i = 0; i < values.length; i++) {
    this.add(this._types[i], values[i]);
  }
  this._params = true;
};

exports.create = function createWriter(params) {
  var writer = new Writer(params.types);
  writer.setValues(params.values);
  return writer;
};

Object.defineProperties(Writer.prototype, {
  hasParameters: {
    get: function hasParameters() {
      return this._params;
    }
  },
  finished: {
    get: function isFinished() {
      return !this._lobs.length && !this._buffers.length;
    }
  },
  length: {
    get: function getLength() {
      return this._bytesWritten;
    }
  }
});

Writer.prototype.add = function add(type, value) {
  if (typeof value === 'undefined' || value === null) {
    this.pushNull(type);
  } else {
    this[type](value);
  }
};

Writer.prototype.finializeParameters = function finializeParameters(
  bytesRemaining, cb) {
  var self = this;
  var stream, header;

  function finalize() {
    /* jshint bitwise:false */
    // update lob options in header
    header[1] |= LobOptions.LAST_DATA;
    // remove current lob from stack
    self._lobs.shift();
  }

  function cleanup() {
    // remove event listeners
    stream.removeListener('error', onerror);
    stream.removeListener('end', onend);
    stream.removeListener('readable', onreadable);
  }

  function onerror(err) {
    /* jshint validthis:true */
    cleanup();
    // stop appending on error
    cb(err);
  }

  function onend() {
    /* jshint validthis:true */
    cleanup();
    // finalize lob
    finalize();
    // process next lob in stack
    util.setImmediate(next);
  }

  function onreadable() {
    /* jshint validthis:true */
    var chunk = this.read(bytesRemaining);
    if (chunk === null) {
      chunk = this.read();
    }
    if (chunk === null) {
      return;
    }
    if (chunk.length > bytesRemaining) {
      cleanup();
      return cb(createReadStreamError());
    }
    // update lob length in header
    var length = header.readInt32LE(2);
    length += chunk.length;
    header.writeInt32LE(length, 2);
    // push chunk
    self.push(chunk);
    bytesRemaining -= chunk.length;
    // stop appending if there is no remaining space
    if (bytesRemaining === 0) {
      cleanup();
      // finalize lob if the stream has already ended
      // because of cleanup we don't get end event in this case
      var state = this._readableState;
      if (state.ended && !state.length) {
        finalize();
      }
      // we are done
      cb(null);
    }
  }

  function next() {
    if (!self._lobs.length || !bytesRemaining) {
      return cb(null);
    }
    // set reabable stream
    stream = self._lobs[0];
    // set lob header
    header = stream._header;
    // update lob options in header
    header[1] = LobOptions.DATA_INCLUDED;
    // update lob position in header
    var position = self._bytesWritten + 1;
    header.writeInt32LE(position, 6);
    // register event handlers
    stream.on('error', onerror);
    stream.on('end', onend);
    stream.on('readable', onreadable);
    onreadable.call(stream);
  }

  next();
};

Writer.prototype.getParameters = function getParameters(bytesAvailable, cb) {
  var self = this;

  function done(err) {
    if (err) {
      return cb(err);
    }
    var buffer = Buffer.concat(self._buffers, self._bytesWritten);
    self.clear();
    cb(null, buffer);
  }
  var bytesRemaining = bytesAvailable - this._bytesWritten;
  this.finializeParameters(bytesRemaining, done);
};

Writer.prototype.finalizeWriteLobRequest = function finalizeWriteLobRequest(
  bytesRemaining, cb) {
  var self = this;
  var stream, header;

  function cleanup() {
    // remove event listeners
    stream.removeListener('error', onerror);
    stream.removeListener('end', onend);
    stream.removeListener('readable', onreadable);
  }

  function onerror(err) {
    /* jshint validthis:true */
    cleanup();
    // stop appending on error
    cb(err);
  }

  function finalize() {
    /* jshint bitwise:false */
    // update lob options in header
    header[8] |= LobOptions.LAST_DATA;
    // remove current lob from stack
    self._lobs.shift();
  }

  function onend() {
    /* jshint validthis:true */
    cleanup();
    // finalize lob
    finalize();
    // process next lob in stack
    util.setImmediate(next);
  }

  function onreadable() {
    /* jshint validthis:true */
    var chunk = this.read(bytesRemaining);
    if (chunk === null) {
      chunk = this.read();
    }
    if (chunk === null) {
      return;
    }
    if (chunk.length > bytesRemaining) {
      cleanup();
      return cb(createReadStreamError());
    }
    // update lob length in buffer
    var length = header.readInt32LE(17);
    length += chunk.length;
    header.writeInt32LE(length, 17);
    // push chunk
    self.push(chunk);
    bytesRemaining -= chunk.length;
    // stop appending if there is no remaining space
    if (bytesRemaining === 0) {
      cleanup();
      // finalize lob if the stream has already ended
      // because of cleanup we don't get end event in this case
      var state = this._readableState;
      if (state.ended && !state.length) {
        finalize();
      }
      // we are done
      cb(null);
    }
  }

  function next() {
    if (!self._lobs.length || !bytesRemaining) {
      return cb(null);
    }
    // set reabable stream
    stream = self._lobs[0];
    // set lob header
    header = new Buffer(21);
    // set locatorId
    stream._locatorId.copy(header, 0);
    // update lob options in header
    header[8] = LobOptions.DATA_INCLUDED;
    // offset 0 means append
    header.fill(0x00, 9, 17);
    // length
    header.writeInt32LE(0, 17);
    // push header
    self.push(header);
    bytesRemaining -= header.length;
    // increase count
    self._argumentCount += 1;
    // register event handlers
    stream.on('error', onerror);
    stream.on('end', onend);
    stream.on('readable', onreadable);
    onreadable.call(stream);
  }

  next();
};

Writer.prototype.getWriteLobRequest = function getWriteLobRequest(
  bytesRemaining, cb) {
  var self = this;

  function done(err) {
    if (err) {
      return cb(err);
    }
    var part = {
      argumentCount: self._argumentCount,
      buffer: Buffer.concat(self._buffers, self._bytesWritten)
    };
    self.clear();
    cb(null, part);
  }
  this.clear();
  this.finalizeWriteLobRequest(bytesRemaining, done);
};

Writer.prototype.update = function update(writeLobReply) {
  var stream, locatorId;
  for (var i = 0; i < this._lobs.length; i++) {
    locatorId = writeLobReply[i];
    stream = this._lobs[i];
    if (Buffer.isBuffer(locatorId) && util.isObject(stream)) {
      stream._header = undefined;
      stream._locatorId = locatorId;
    }
  }
};

Writer.prototype.push = function push(buffer) {
  this._bytesWritten += buffer.length;
  this._buffers.push(buffer);
};

Writer.prototype.pushNull = function pushNull(type) {
  /* jshint bitwise:false */
  var buffer = new Buffer([NormalizedTypeCode[type] | 0x80]);
  this.push(buffer);
};

Writer.prototype.pushLob = function pushLob(buffer, value) {
  this.push(buffer);
  var stream;
  if (Buffer.isBuffer(value)) {
    stream = new Readable();
    stream.push(value);
    stream.push(null);
  } else if (value instanceof Readable) {
    stream = value;
  } else if (value.readable === true) {
    stream = new Readable().wrap(value);
  } else {
    throw createInputError('LOB');
  }
  if (stream) {
    stream._header = buffer;
    this._lobs.push(stream);
  }
};

Writer.prototype[TypeCode.TINYINT] = function writeTinyInt(value) {
  var buffer = new Buffer(2);
  buffer[0] = TypeCode.TINYINT;
  buffer.writeUInt8(value, 1);
  this.push(buffer);
};

Writer.prototype[TypeCode.SMALLINT] = function writeSmallInt(value) {
  var buffer = new Buffer(3);
  buffer[0] = TypeCode.SMALLINT;
  buffer.writeInt16LE(value, 1);
  this.push(buffer);
};

Writer.prototype[TypeCode.INT] = function writeInt(value) {
  var buffer = new Buffer(5);
  buffer[0] = TypeCode.INT;
  buffer.writeInt32LE(value, 1);
  this.push(buffer);
};

Writer.prototype[TypeCode.BIGINT] = function writeBigInt(value) {
  var buffer = new Buffer(9);
  buffer[0] = TypeCode.BIGINT;
  bignum.writeInt64LE(buffer, value, 1);
  this.push(buffer);
};

Writer.prototype[TypeCode.REAL] = function writeReal(value) {
  var buffer = new Buffer(5);
  buffer[0] = TypeCode.REAL;
  buffer.writeFloatLE(value, 1);
  this.push(buffer);
};

Writer.prototype[TypeCode.DOUBLE] = function writeDouble(value) {
  var buffer = new Buffer(9);
  buffer[0] = TypeCode.DOUBLE;
  buffer.writeDoubleLE(value, 1);
  this.push(buffer);
};

Writer.prototype[TypeCode.DECIMAL] = function writeDecimal(value) {
  var decimal;
  if (util.isString(value)) {
    decimal = stringToDecimal(value);
  } else if (util.isNumber(value)) {
    decimal = stringToDecimal(value.toExponential());
  } else {
    throw createInputError('DECIMAL');
  }
  var buffer = new Buffer(17);
  buffer[0] = TypeCode.DECIMAL;
  bignum.writeDec128(buffer, decimal, 1);
  this.push(buffer);
};

Writer.prototype[TypeCode.NSTRING] = function writeNString(value) {
  this.writeCharacters(value, 'utf8');
};

Writer.prototype[TypeCode.STRING] = function writeString(value) {
  this.writeCharacters(value, 'ascii');
};

Writer.prototype.writeCharacters = function writeCharacters(value, encoding) {
  var type = encoding === 'ascii' ? TypeCode.STRING : TypeCode.NSTRING;
  var length = Buffer.byteLength(value, encoding);
  var buffer;
  if (length <= 245) {
    buffer = new Buffer(2 + length);
    buffer[0] = type;
    buffer[1] = length;
    buffer.write(value, 2, length, encoding);
  } else if (length <= 32767) {
    buffer = new Buffer(4 + length);
    buffer[0] = type;
    buffer[1] = 246;
    buffer.writeInt16LE(length, 2);
    buffer.write(value, 4, length, encoding);
  } else {
    buffer = new Buffer(6 + length);
    buffer[0] = type;
    buffer[1] = 247;
    buffer.writeInt32LE(length, 2);
    buffer.write(value, 6, length, encoding);
  }
  this.push(buffer);
};

Writer.prototype[TypeCode.BINARY] = function writeBinary(value) {
  var length = value.length;
  var buffer;
  if (length <= 245) {
    buffer = new Buffer(2 + length);
    buffer[0] = TypeCode.BINARY;
    buffer[1] = length;
    value.copy(buffer, 2);
  } else if (length <= 32767) {
    buffer = new Buffer(4 + length);
    buffer[0] = TypeCode.BINARY;
    buffer[1] = 246;
    buffer.writeInt16LE(length, 2);
    value.copy(buffer, 4);
  } else {
    buffer = new Buffer(6 + length);
    buffer[0] = TypeCode.BINARY;
    buffer[1] = 247;
    buffer.writeInt32LE(length, 2);
    value.copy(buffer, 6);
  }
  this.push(buffer);
};

Writer.prototype[TypeCode.BLOB] = function writeBLob(value) {
  var buffer = new Buffer(10);
  buffer.fill(0x00);
  buffer[0] = TypeCode.BLOB;
  this.pushLob(buffer, value);
};

Writer.prototype[TypeCode.CLOB] = function writeCLob(value) {
  var buffer = new Buffer(10);
  buffer.fill(0x00);
  buffer[0] = TypeCode.CLOB;
  if (util.isString(value)) {
    value = new Buffer(value, 'ascii');
  }
  this.pushLob(buffer, value);
};

Writer.prototype[TypeCode.NCLOB] = function writeNCLob(value) {
  var buffer = new Buffer(10);
  buffer.fill(0x00);
  buffer[0] = TypeCode.NCLOB;
  if (util.isString(value)) {
    value = new Buffer(value, 'utf8');
  }
  this.pushLob(buffer, value);
};

Writer.prototype[TypeCode.TIME] = function writeTime(value) {
  /* jshint bitwise:false */
  var hours, minutes, milliseconds;
  if (util.isString(value)) {
    var time = value.match(REGEX.TIME);
    if (!time) {
      throw createInputError('TIME');
    }
    hours = ~~time[1];
    minutes = ~~time[2];
    milliseconds = Math.floor(time[3] * 1000);
  } else {
    throw createInputError('TIME');
  }
  var buffer = new Buffer(5);
  buffer[0] = TypeCode.TIME;
  buffer[1] = hours | 0x80;
  buffer[2] = minutes;
  buffer.writeUInt16LE(milliseconds, 3);
  this.push(buffer);
};

Writer.prototype[TypeCode.DATE] = function writeDate(value) {
  /* jshint bitwise:false */
  var year, month, day;
  if (util.isString(value)) {
    var date = value.match(REGEX.DATE);
    if (!date) {
      throw createInputError('DATE');
    }
    year = ~~date[1];
    month = ~~date[2] - 1;
    day = ~~date[3];
  } else {
    throw createInputError('DATE');
  }
  var buffer = new Buffer(5);
  buffer[0] = TypeCode.DATE;
  buffer.writeUInt16LE(year, 1);
  buffer[2] |= 0x80;
  buffer[3] = month;
  buffer[4] = day;
  this.push(buffer);
};

Writer.prototype[TypeCode.TIMESTAMP] = function writeTimestamp(value) {
  /* jshint bitwise:false */
  var year, month, day, hours, minutes, milliseconds;
  if (util.isString(value)) {
    var ts = value.match(REGEX.TIMESTAMP);
    if (!ts) {
      throw createInputError('TIMESTAMP');
    }
    year = ~~ts[1];
    month = ~~ts[2] - 1;
    day = ~~ts[3];
    hours = ~~ts[4];
    minutes = ~~ts[5];
    milliseconds = Math.floor(ts[6] * 1000);
  } else {
    throw createInputError('TIMESTAMP');
  }
  var buffer = new Buffer(9);
  buffer[0] = TypeCode.TIMESTAMP;
  buffer.writeUInt16LE(year, 1);
  buffer[2] |= 0x80;
  buffer[3] = month;
  buffer[4] = day;
  buffer[5] = hours | 0x80;
  buffer[6] = minutes;
  buffer.writeUInt16LE(milliseconds, 7);
  this.push(buffer);
};

Writer.prototype[TypeCode.DAYDATE] = function writeDayDate(value) {
  /* jshint unused:false */
  throw createNotImplementedError();
};

Writer.prototype[TypeCode.SECONDTIME] = function writeSecondTime(value) {
  /* jshint unused:false */
  throw createNotImplementedError();
};

Writer.prototype[TypeCode.LONGDATE] = function writeLongDate(value) {
  /* jshint unused:false */
  throw createNotImplementedError();
};

Writer.prototype[TypeCode.SECONDDATE] = function writeSecondDate(value) {
  /* jshint unused:false */
  throw createNotImplementedError();
};

function stringToDecimal(str) {
  /* jshint bitwise:false */
  var dec = str.match(REGEX.DECIMAL);
  if (!dec) {
    throw createInputError('DECIMAL');
  }
  var sign = dec[1] === '-' ? -1 : 1;
  var mInt = dec[2] || '0';
  var mFrac = dec[3] || '';
  var exp = ~~dec[4];
  return {
    s: sign,
    m: mInt + mFrac,
    e: exp - mFrac.length
  };
}

function createInputError(type) {
  return new Error(util.format('Wrong input for %s type', type));
}

function createNotImplementedError() {
  return new Error('Not implemented yet');
}

function createReadStreamError() {
  return new Error('Chunk length larger than remaining bytes');
}
}).call(this,require("buffer").Buffer)
},{"../util":242,"./common":210,"buffer":"buffer"}],179:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var SCRAMSHA256 = require('./SCRAMSHA256');
var SAML = require('./SAML');
var SessionCookie = require('./SessionCookie');

module.exports = Manager;

function Manager(options) {
  options = options || {};
  this.user = options.user || '';
  this._authMethod = undefined;
  this._authMethods = [];
  if (options.assertion || (!options.user && options.password)) {
    this._authMethods.push(new SAML(options));
  }
  if (options.sessionCookie) {
    this._authMethods.push(new SessionCookie(options));
  }
  if (options.user && options.password) {
    this._authMethods.push(new SCRAMSHA256(options));
  }
  if (!this._authMethods.length) {
    throw noAuthMethodFound();
  }
}

Object.defineProperties(Manager.prototype, {
  userFromServer: {
    get: function getUserFromServer() {
      if (this._authMethod && this._authMethod.user) {
        return this._authMethod.user;
      }
      return this.user;
    }
  },
  sessionCookie: {
    get: function getSessionCookie() {
      if (this._authMethod && this._authMethod.sessionCookie) {
        return this._authMethod.sessionCookie;
      }
    }
  }
});

Manager.prototype.initialData = function initialData() {
  var fields = [this.user];
  this._authMethods.forEach(function initialDataOfMethod(method) {
    fields.push(method.name, method.initialData());
  });
  return fields;
};

Manager.prototype.initialize = function initialize(fields) {
  var initializedMethods = [];
  var name, method, buffer;
  while (fields.length) {
    name = fields.shift().toString('ascii');
    method = this.getMethod(name);
    buffer = fields.shift();
    if (method && buffer) {
      method.initialize(buffer);
      initializedMethods.push(method);
    }
  }
  if (!initializedMethods.length) {
    throw noAuthMethodFound();
  }
  this._authMethod = initializedMethods.shift();
  this._authMethods = undefined;
};

Manager.prototype.finalData = function finalData() {
  var fields = [this.userFromServer];
  if (this._authMethod) {
    fields.push(this._authMethod.name, this._authMethod.finalData());
  }
  return fields;
};

Manager.prototype.finalize = function finalize(fields) {
  var name, buffer;
  while (fields.length) {
    name = fields.shift().toString('ascii');
    buffer = fields.shift();
    if (this._authMethod.name === name) {
      this._authMethod.finalize(buffer);
      break;
    }
  }
};

Manager.prototype.getMethod = function getMethod(name) {
  var method;
  for (var i = 0; i < this._authMethods.length; i++) {
    method = this._authMethods[i];
    if (method.name === name) {
      return method;
    }
  }
};

function noAuthMethodFound() {
  var error = new Error('No authentication method found');
  error.code = 'EHDBNOAUTHMETH';
  return error;
}
},{"./SAML":180,"./SCRAMSHA256":181,"./SessionCookie":182}],180:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = SAML;

function SAML(options) {
  options = options || {};
  this.name = 'SAML';
  this.assertion = options.assertion || options.password;
  this.user = undefined;
  this.sessionCookie = undefined;
}

SAML.prototype.initialData = function initialData() {
  return this.assertion;
};

SAML.prototype.initialize = function initialize(buffer) {
  this.user = buffer.toString('utf8');
};

SAML.prototype.finalData = function finalData() {
  return new Buffer(0);
};

SAML.prototype.finalize = function finalize(buffer) {
  this.sessionCookie = buffer;
};
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],181:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var crypto = require('crypto');
var util = require('../../util');
var Fields = require('../data/Fields');

var CLIENT_PROOF_SIZE = 32;
var CLIENT_CHALLENGE_SIZE = 64;

module.exports = SCRAMSHA256;

function createClientChallenge() {
  return crypto.randomBytes(CLIENT_CHALLENGE_SIZE);
}

function SCRAMSHA256(options) {
  options = options || {};
  this.name = 'SCRAMSHA256';
  this.password = options.password;
  if (util.isString(this.password)) {
    this.password = new Buffer(this.password, 'utf8');
  }
  this.clientChallenge = options.clientChallenge || createClientChallenge();
  this.clientProof = undefined;
}

SCRAMSHA256.prototype.initialData = function initialData() {
  return this.clientChallenge;
};

SCRAMSHA256.prototype.initialize = function initialize(buffer) {
  var serverChallengeData = Fields.read({
    argumentCount: 1,
    buffer: buffer
  });
  this.clientProof = calculateClientProof([serverChallengeData[0]],
    serverChallengeData[1], this.clientChallenge, this.password);
};

SCRAMSHA256.prototype.finalData = function finalData() {
  return this.clientProof;
};

SCRAMSHA256.prototype.finalize = function finalize(buffer) {
  /* jshint unused:false */
};

function calculateClientProof(salts, serverKey, clientKey, password) {
  var buf = new Buffer(2 + (CLIENT_PROOF_SIZE + 1) * salts.length);
  buf[0] = 0x00;
  buf.writeInt8(salts.length, 1);
  var offset = 2;
  salts.forEach(function scrambleSalt(salt) {
    buf.writeInt8(CLIENT_PROOF_SIZE, offset);
    offset += 1;
    scramble(salt, serverKey, clientKey, password).copy(buf, offset);
    offset += CLIENT_PROOF_SIZE;
  });
  return buf;
}

function scramble(salt, serverKey, clientKey, password) {
  var length = salt.length + serverKey.length + clientKey.length;
  var msg = Buffer.concat([salt, serverKey, clientKey], length);
  var key = sha256(hmac(password, salt));
  var sig = hmac(sha256(key), msg);
  return xor(sig, key);
}

function xor(a, b) {
  /* jshint bitwise:false */
  var result = new Buffer(a.length);
  for (var i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

function hmac(key, msg) {
  var hash = crypto.createHmac('sha256', key);
  hash.update(msg);
  return new Buffer(hash.digest(), 'binary');
}

function sha256(msg) {
  var hash = crypto.createHash('sha256');
  hash.update(msg);
  return new Buffer(hash.digest(), 'binary');
}
}).call(this,require("buffer").Buffer)
},{"../../util":242,"../data/Fields":213,"buffer":"buffer","crypto":6}],182:[function(require,module,exports){
(function (process,Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var os = require('os');

module.exports = SessionCookie;

function SessionCookie(options) {
  options = options || {};
  this.name = 'SessionCookie';
  var pid = process.pid || 'nodejs';
  var termId = new Buffer(pid + '@' + os.hostname(), 'utf8');
  var rawSessionCookie = options.sessionCookie;
  var length = rawSessionCookie.length + termId.length;
  this.sessionCookie = new Buffer.concat([rawSessionCookie, termId], length);
}

SessionCookie.prototype.initialData = function initialData() {
  return this.sessionCookie;
};

SessionCookie.prototype.initialize = function initialize(buffer) {
  /* jshint unused:false */
};

SessionCookie.prototype.finalData = function finalData() {
  return new Buffer(0);
};

SessionCookie.prototype.finalize = function finalize(buffer) {
  /* jshint unused:false */
};
}).call(this,require('_process'),require("buffer").Buffer)
},{"_process":147,"buffer":"buffer","os":145}],183:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var Manager = require('./Manager');

exports.createManager = function createManager(options) {
  return new Manager(options);
};
},{"./Manager":179}],184:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  OFF: 0,
  CONNECTION: 1,
  STATEMENT_ONLY: 2,
  STATEMENT_CONNECTION: 3
};
},{}],185:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  SELFETCH_OFF: 1,
  SCROLLABLE_CURSOR_ON: 2,
  NO_RESULT_SET_CLOSE_NEEDED: 4,
  HOLD_CURSORS_OVER_COMMIT: 8,
  EXECUTE_LOCALLY: 16
};
},{}],186:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  HOLD_CURSORS_OVER_COMMIT: 1
};
},{}],187:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  CONNECTION_ID: 1,
  COMPLETE_ARRAY_EXECUTION: 2,
  CLIENT_LOCALE: 3,
  SUPPORTS_LARGE_BULK_OPERATIONS: 4,
  LARGE_NUMBER_OF_PARAMETERS_SUPPORT: 10,
  SYSTEM_ID: 11,
  DATA_FORMAT_VERSION: 12,
  SELECT_FOR_UPDATE_SUPPORTED: 14,
  CLIENT_DISTRIBUTION_MODE: 15,
  ENGINE_DATA_FORMAT_VERSION: 16,
  DISTRIBUTION_PROTOCOL_VERSION: 17,
  SPLIT_BATCH_COMMANDS: 18,
  USE_TRANSACTION_FLAGS_ONLY: 19,
  ROW_AND_COLUMN_OPTIMIZED_FORMAT: 20,
  IGNORE_UNKNOWN_PARTS: 21,
  DATA_FORMAT_VERSION2: 23
};
},{}],188:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var ConnectOption = require('./ConnectOption');
var TypeCode = require('./TypeCode');

var ConnectOptionType = module.exports = {};
ConnectOptionType[ConnectOption.CONNECTION_ID] = TypeCode.INT;
ConnectOptionType[ConnectOption.COMPLETE_ARRAY_EXECUTION] = TypeCode.BOOLEAN;
ConnectOptionType[ConnectOption.CLIENT_LOCALE] = TypeCode.STRING;
ConnectOptionType[ConnectOption.SUPPORTS_LARGE_BULK_OPERATIONS] = TypeCode.BOOLEAN;
ConnectOptionType[ConnectOption.LARGE_NUMBER_OF_PARAMETERS_SUPPORT] = TypeCode.BOOLEAN;
ConnectOptionType[ConnectOption.SYSTEM_ID] = TypeCode.STRING;
ConnectOptionType[ConnectOption.DATA_FORMAT_VERSION] = TypeCode.INT;
ConnectOptionType[ConnectOption.SELECT_FOR_UPDATE_SUPPORTED] = TypeCode.BOOLEAN;
ConnectOptionType[ConnectOption.CLIENT_DISTRIBUTION_MODE] = TypeCode.INT;
ConnectOptionType[ConnectOption.ENGINE_DATA_FORMAT_VERSION] = TypeCode.INT;
ConnectOptionType[ConnectOption.DISTRIBUTION_PROTOCOL_VERSION] = TypeCode.BOOLEAN;
ConnectOptionType[ConnectOption.SPLIT_BATCH_COMMANDS] = TypeCode.BOOLEAN;
ConnectOptionType[ConnectOption.USE_TRANSACTION_FLAGS_ONLY] = TypeCode.BOOLEAN;
ConnectOptionType[ConnectOption.ROW_AND_COLUMN_OPTIMIZED_FORMAT] = TypeCode.BOOLEAN;
ConnectOptionType[ConnectOption.IGNORE_UNKNOWN_PARTS] = TypeCode.BOOLEAN;
ConnectOptionType[ConnectOption.DATA_FORMAT_VERSION2] = TypeCode.INT;
},{"./ConnectOption":187,"./TypeCode":209}],189:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var ConnectOption = require('./ConnectOption');
var TypeCode = require('./TypeCode');
var ClientDistributionMode = require('./ClientDistributionMode');
var DataFormatVersion = require('./DataFormatVersion');
var DistributionProtocolVersion = require('./DistributionProtocolVersion');

module.exports = {
  PACKET_HEADER_LENGTH: 32,
  SEGMENT_HEADER_LENGTH: 24,
  PART_HEADER_LENGTH: 16,
  MAX_PACKET_SIZE: Math.pow(2, 17),
  MAX_RESULT_SET_SIZE: Math.pow(2, 20),
  DEFAULT_CONNECT_OPTIONS: [{
    name: ConnectOption.CLIENT_LOCALE,
    value: 'en_US',
    type: TypeCode.STRING
  }, {
    name: ConnectOption.COMPLETE_ARRAY_EXECUTION,
    value: true,
    type: TypeCode.BOOLEAN
  }, {
    name: ConnectOption.DATA_FORMAT_VERSION2,
    value: DataFormatVersion.COMPLETE_DATATYPE_SUPPORT,
    type: TypeCode.INT
  }, {
    name: ConnectOption.DATA_FORMAT_VERSION,
    value: DataFormatVersion.COMPLETE_DATATYPE_SUPPORT,
    type: TypeCode.INT
  }, {
    name: ConnectOption.DISTRIBUTION_ENABLED,
    value: false,
    type: TypeCode.BOOLEAN
  }, {
    name: ConnectOption.DISTRIBUTION_MODE,
    value: ClientDistributionMode.OFF,
    type: TypeCode.INT
  }, {
    name: ConnectOption.DISTRIBUTION_PROTOCOL_VERSION,
    value: DistributionProtocolVersion.BASE,
    type: TypeCode.INT
  }, {
    name: ConnectOption.SELECT_FOR_UPDATE_SUPPORTED,
    value: false,
    type: TypeCode.BOOLEAN
  }, {
    name: ConnectOption.ROW_AND_COLUMN_OPTIMIZED_FORMAT,
    value: true,
    type: TypeCode.BOOLEAN
  }]
};
},{"./ClientDistributionMode":184,"./ConnectOption":187,"./DataFormatVersion":190,"./DistributionProtocolVersion":191,"./TypeCode":209}],190:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  BASE_FORMAT: 0,
  COMPLETE_DATATYPE_SUPPORT: 1,
  // deprecated
  EXTENDED_DATE_TIME_SUPPORT: 3,
  LEVEL4: 4
};
},{}],191:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  BASE: 0,
  STATEMENT_SEQUENCE_NUMBER_SUPPORTED: 1
};
},{}],192:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  WARNING: 0,
  ERROR: 1,
  FATAL: 2
};
},{}],193:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  NIL: 0,
  DDL: 1,
  INSERT: 2,
  UPDATE: 3,
  DELETE: 4,
  SELECT: 5,
  SELECT_FOR_UPDATE: 6,
  EXPLAIN: 7,
  DB_PROCEDURE_CALL: 8,
  DB_PROCEDURE_CALL_WITH_RESULT: 9,
  FETCH: 10,
  COMMIT: 11,
  ROLLBACK: 12,
  SAVEPOINT: 13,
  CONNECT: 14,
  WRITE_LOB: 15,
  READ_LOB: 16,
  PING: 17,
  DISCONNECT: 18,
  CLOSE_CURSOR: 19,
  FIND_LOB: 20,
  ABAP_STREAM: 21,
  XA_START: 22,
  XA_JOIN: 23
};
},{}],194:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  INPUT: 1,
  IN_OUT: 2,
  OUTPUT: 4
};
},{}],195:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  NULL_INDICATOR: 1,
  DATA_INCLUDED: 2,
  LAST_DATA: 4
};
},{}],196:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  UNKNOWN: 0,
  BLOB: 1,
  CLOB: 2,
  NCLOB: 3
};
},{}],197:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  NIL: 0,
  EXECUTE_DIRECT: 2,
  PREPARE: 3,
  ABAP_STREAM: 4,
  XA_START: 5,
  XA_JOIN: 6,
  EXECUTE: 13,
  READ_LOB: 16,
  WRITE_LOB: 17,
  FIND_LOB: 18,
  PING: 25,
  AUTHENTICATE: 65,
  CONNECT: 66,
  COMMIT: 67,
  ROLLBACK: 68,
  CLOSE_RESULT_SET: 69,
  DROP_STATEMENT_ID: 70,
  FETCH_NEXT: 71,
  DISCONNECT: 77,
  EXECUTE_ITAB: 78,
  FETCH_NEXT_ITAB: 79,
  INSERT_NEXT_ITAB: 80,
  BATCH_PREPARE: 81
};
},{}],198:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var TypeCode = require('./TypeCode');

var NormalizedTypeCode = module.exports = {};
// TinyInt
NormalizedTypeCode[TypeCode.TINYINT] = TypeCode.TINYINT;
// SmallInt
NormalizedTypeCode[TypeCode.SMALLINT] = TypeCode.SMALLINT;
// Int
NormalizedTypeCode[TypeCode.INT] = TypeCode.INT;
// BigInt
NormalizedTypeCode[TypeCode.BIGINT] = TypeCode.BIGINT;
// Double
NormalizedTypeCode[TypeCode.DOUBLE] = TypeCode.DOUBLE;
// Real
NormalizedTypeCode[TypeCode.REAL] = TypeCode.REAL;
// Decimal
NormalizedTypeCode[TypeCode.DECIMAL] = TypeCode.DECIMAL;
// String
NormalizedTypeCode[TypeCode.STRING] = TypeCode.STRING;
NormalizedTypeCode[TypeCode.VARCHAR1] = TypeCode.STRING;
NormalizedTypeCode[TypeCode.VARCHAR2] = TypeCode.STRING;
NormalizedTypeCode[TypeCode.CHAR] = TypeCode.STRING;
NormalizedTypeCode[TypeCode.SHORTTEXT] = TypeCode.STRING;
NormalizedTypeCode[TypeCode.ALPHANUM] = TypeCode.STRING;
// NString
NormalizedTypeCode[TypeCode.NCHAR] = TypeCode.NSTRING;
NormalizedTypeCode[TypeCode.NVARCHAR] = TypeCode.NSTRING;
NormalizedTypeCode[TypeCode.NSTRING] = TypeCode.NSTRING;
// Binary
NormalizedTypeCode[TypeCode.BINARY] = TypeCode.BINARY;
NormalizedTypeCode[TypeCode.VARBINARY] = TypeCode.BINARY;
NormalizedTypeCode[TypeCode.BSTRING] = TypeCode.BINARY;
// BLob
NormalizedTypeCode[TypeCode.BLOB] = TypeCode.BLOB;
NormalizedTypeCode[TypeCode.LOCATOR] = TypeCode.BLOB;
// Clob
NormalizedTypeCode[TypeCode.CLOB] = TypeCode.CLOB;
// NCLob
NormalizedTypeCode[TypeCode.NCLOB] = TypeCode.NCLOB;
NormalizedTypeCode[TypeCode.NLOCATOR] = TypeCode.NCLOB;
NormalizedTypeCode[TypeCode.TEXT] = TypeCode.NCLOB;
// Date
NormalizedTypeCode[TypeCode.DATE] = TypeCode.DATE;
// Time
NormalizedTypeCode[TypeCode.TIME] = TypeCode.TIME;
// Timestamp
NormalizedTypeCode[TypeCode.TIMESTAMP] = TypeCode.TIMESTAMP;
// DayDate
NormalizedTypeCode[TypeCode.DAYDATE] = TypeCode.DAYDATE;
// SecondTime
NormalizedTypeCode[TypeCode.SECONDTIME] = TypeCode.SECONDTIME;
// LongDate
NormalizedTypeCode[TypeCode.LONGDATE] = TypeCode.LONGDATE;
// SecondDate
NormalizedTypeCode[TypeCode.SECONDDATE] = TypeCode.SECONDDATE;
},{"./TypeCode":209}],199:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  MANDATORY: 1,
  OPTIONAL: 2,
  DEFAULT: 4,
  ESCAPE_CHAR: 8,
  READONLY: 16,
  AUTO_INCREMENT: 32
};
},{}],200:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  NIL: 0,
  COMMAND: 3,
  RESULT_SET: 5,
  ERROR: 6,
  STATEMENT_ID: 10,
  TRANSACTION_ID: 11,
  ROWS_AFFECTED: 12,
  RESULT_SET_ID: 13,
  TOPOLOGY_INFORMATION: 15,
  TABLE_LOCATION: 16,
  READ_LOB_REQUEST: 17,
  READ_LOB_REPLY: 18,
  TABLE_NAME: 19,
  /*
  ABAP_ISTREAM: 25,
  ABAP_OSTREAM: 26,
  */
  COMMAND_INFO: 27,
  WRITE_LOB_REQUEST: 28,
  WRITE_LOB_REPLY: 30,
  PARAMETERS: 32,
  AUTHENTICATION: 33,
  SESSION_CONTEXT: 34,
  CLIENT_ID: 35,
  STATEMENT_CONTEXT: 39,
  PARTITION_INFORMATION: 40,
  OUTPUT_PARAMETERS: 41,
  CONNECT_OPTIONS: 42,
  COMMIT_OPTIONS: 43,
  FETCH_OPTIONS: 44,
  FETCH_SIZE: 45,
  PARAMETER_METADATA: 47,
  RESULT_SET_METADATA: 48,
  FIND_LOB_REQUEST: 49,
  FIND_LOB_REPLY: 50,
  /*
  ITAB_SHM: 51,
  ITAB_CHUNK_METADATA: 53,
  ITAB_METADATA: 55,
  ITAB_RESULT_CHUNK: 56,
  */
  CLIENT_INFO: 57,
  /*
  STREAM_DATA: 58,
  OSTREAM_RESULT: 59,
  FDA_REQUEST_METADATA: 60,
  FDA_REPLY_METADATA: 61,
  BATCH_PREPARE: 62,
  BATCH_EXECUTE: 63,
  */
  TRANSACTION_FLAGS: 64
};
},{}],201:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var TypeCode = require('./TypeCode');

var ReadFunction = module.exports = {};

var READ_TINYINT = 'readTinyInt';
var READ_SMALLINT = 'readSmallInt';
var READ_INT = 'readInt';
var READ_BIGINT = 'readBigInt';
var READ_STRING = 'readString';
var READ_BINARY = 'readBinary';
var READ_DATE = 'readDate';
var READ_DAYDATE = 'readDayDate';
var READ_TIME = 'readTime';
var READ_SECONDTIME = 'readSecondTime';
var READ_TIMESTAMP = 'readTimestamp';
var READ_LONGDATE = 'readLongDate';
var READ_SECONDDATE = 'readSecondDate';
var READ_BLOB = 'readBLob';
var READ_CLOB = 'readCLob';
var READ_NCLOB = 'readNCLob';
var READ_DOUBLE = 'readDouble';
var READ_FLOAT = 'readFloat';
var READ_DECIMAL = 'readDecimal';

ReadFunction[TypeCode.TINYINT] = READ_TINYINT;
ReadFunction[TypeCode.SMALLINT] = READ_SMALLINT;
ReadFunction[TypeCode.INT] = READ_INT;
ReadFunction[TypeCode.BIGINT] = READ_BIGINT;
ReadFunction[TypeCode.STRING] = READ_STRING;
ReadFunction[TypeCode.VARCHAR1] = READ_STRING;
ReadFunction[TypeCode.VARCHAR2] = READ_STRING;
ReadFunction[TypeCode.CHAR] = READ_STRING;
ReadFunction[TypeCode.NCHAR] = READ_STRING;
ReadFunction[TypeCode.NVARCHAR] = READ_STRING;
ReadFunction[TypeCode.NSTRING] = READ_STRING;
ReadFunction[TypeCode.SHORTTEXT] = READ_STRING;
ReadFunction[TypeCode.ALPHANUM] = READ_STRING;
ReadFunction[TypeCode.BINARY] = READ_BINARY;
ReadFunction[TypeCode.VARBINARY] = READ_BINARY;
ReadFunction[TypeCode.BSTRING] = READ_BINARY;
ReadFunction[TypeCode.DATE] = READ_DATE;
ReadFunction[TypeCode.TIME] = READ_TIME;
ReadFunction[TypeCode.TIMESTAMP] = READ_TIMESTAMP;
ReadFunction[TypeCode.DAYDATE] = READ_DAYDATE;
ReadFunction[TypeCode.SECONDTIME] = READ_SECONDTIME;
ReadFunction[TypeCode.LONGDATE] = READ_LONGDATE;
ReadFunction[TypeCode.SECONDDATE] = READ_SECONDDATE;
ReadFunction[TypeCode.BLOB] = READ_BLOB;
ReadFunction[TypeCode.LOCATOR] = READ_BLOB;
ReadFunction[TypeCode.CLOB] = READ_CLOB;
ReadFunction[TypeCode.NCLOB] = READ_NCLOB;
ReadFunction[TypeCode.NLOCATOR] = READ_NCLOB;
ReadFunction[TypeCode.TEXT] = READ_NCLOB;
ReadFunction[TypeCode.DOUBLE] = READ_DOUBLE;
ReadFunction[TypeCode.REAL] = READ_FLOAT;
ReadFunction[TypeCode.DECIMAL] = READ_DECIMAL;
},{"./TypeCode":209}],202:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  LAST: 1,
  NEXT: 2,
  FIRST: 4,
  ROW_NOT_FOUND: 8,
  CLOSED: 16
};
},{}],203:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  INVALID: 0,
  REQUEST: 1,
  REPLY: 2,
  ERROR: 5
};
},{}],204:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  PRIMARY_CONNECTION_ID: 1,
  PRIMARY_HOST: 2,
  PRIMARY_PORT: 3,
  MASTER_CONNECTION_ID: 4,
  MASTER_HOST: 5,
  MASTER_PORT: 6
};
},{}],205:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  STATEMENT_SEQUENCE_INFO: 1,
  SERVER_EXECUTION_TIME: 2
};
},{}],206:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var StatementContext = require('./StatementContext');
var TypeCode = require('./TypeCode');

var StatementContextType = module.exports = {};
StatementContextType[StatementContext.STATEMENT_SEQUENCE_INFO] = TypeCode.BSTRING;
StatementContextType[StatementContext.SERVER_EXECUTION_TIME] = TypeCode.INT;
},{"./StatementContext":205,"./TypeCode":209}],207:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  HOST_NAME: 1,
  HOST_PORT_NUMBER: 2,
  TENAT_NAME: 3,
  LOAD_FACTOR: 4,
  VOLUME_ID: 5,
  IS_MASTER: 6,
  IS_CURRENT_SESSION: 7,
  SERVICE_TYPE: 8,
  NETWORK_DOMAIN: 9,
  IS_STANDBY: 10,
  ALL_IP_ADRESSES: 11,
  ALL_HOST_NAMES: 12
};
},{}],208:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  ROLLED_BACK: 0,
  COMMITTED: 1,
  NEW_ISOLATION_LEVEL: 2,
  DDL_COMMIT_MODE_CHANGED: 3,
  WRITE_TRANSACTION_STARTED: 4,
  NO_WRITE_TRANSACTION_STARTED: 5,
  SESSION_CLOSING_TRANSACTION_ERRROR: 6
};
},{}],209:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

module.exports = {
  NULL: 0,
  TINYINT: 1,
  SMALLINT: 2,
  INT: 3,
  BIGINT: 4,
  DECIMAL: 5,
  REAL: 6,
  DOUBLE: 7,
  CHAR: 8,
  VARCHAR1: 9,
  NCHAR: 10,
  NVARCHAR: 11,
  BINARY: 12,
  VARBINARY: 13,
  DATE: 14,
  TIME: 15,
  TIMESTAMP: 16,
  TIME_TZ: 17,
  TIME_LTZ: 18,
  TIMESTAMP_TZ: 19,
  TIMESTAMP_LTZ: 20,
  INTERVAL_YM: 21,
  INTERVAL_DS: 22,
  ROWID: 23,
  UROWID: 24,
  CLOB: 25,
  NCLOB: 26,
  BLOB: 27,
  BOOLEAN: 28,
  STRING: 29,
  NSTRING: 30,
  LOCATOR: 31,
  NLOCATOR: 32,
  BSTRING: 33,
  DECIMAL_DIGIT_ARRAY: 34,
  VARCHAR2: 35,
  UNUSED1: 36,
  UNUSED2: 37,
  UNUSED3: 38,
  UNUSED4: 39,
  UNUSED5: 40,
  UNUSED6: 41,
  UNUSED7: 42,
  UNUSED8: 43,
  UNUSED9: 44,
  TABLE: 45,
  UNUSED11: 46,
  UNUSED1F: 47,
  ABAPSTREAM: 48,
  ABAPSTRUCT: 49,
  UNUSED12: 50,
  TEXT: 51,
  SHORTTEXT: 52,
  UNUSED15: 53,
  UNUSED16: 54,
  ALPHANUM: 55,
  UNUSED18: 56,
  UNUSED19: 57,
  UNUSED20: 58,
  UNUSED21: 59,
  UNUSED22: 60,
  LONGDATE: 61,
  SECONDDATE: 62,
  DAYDATE: 63,
  SECONDTIME: 64,
  CSDATE: 65,
  CSTIME: 66,
  BLOB_DISK: 71,
  CLOB_DISK: 72,
  NCLOB_DISK: 73
};
},{}],210:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');

exports.ClientDistributionMode = require('./ClientDistributionMode');
exports.CommandOption = require('./CommandOption');
exports.CommitOption = require('./CommitOption');
exports.ConnectOption = require('./ConnectOption');
exports.ConnectOptionType = require('./ConnectOptionType');
exports.DataFormatVersion = require('./DataFormatVersion');
exports.DistributionProtocolVersion = require('./DistributionProtocolVersion');
exports.ErrorLevel = require('./ErrorLevel');
exports.FunctionCode = require('./FunctionCode');
exports.IoType = require('./IoType');
exports.LobOptions = require('./LobOptions');
exports.LobSourceType = require('./LobSourceType');
exports.MessageType = require('./MessageType');
exports.ParameterMode = require('./ParameterMode');
exports.PartKind = require('./PartKind');
exports.ResultSetAttributes = require('./ResultSetAttributes');
exports.SegmentKind = require('./SegmentKind');
exports.SessionContext = require('./SessionContext');
exports.StatementContext = require('./StatementContext');
exports.StatementContextType = require('./StatementContextType');
exports.TransactionFlag = require('./TransactionFlag');
exports.TopologyInformation = require('./TopologyInformation');
exports.TypeCode = require('./TypeCode');
exports.NormalizedTypeCode = require('./NormalizedTypeCode');
exports.ReadFunction = require('./ReadFunction');

invert('ConnectOption');
invert('TransactionFlag');
invert('TopologyInformation');
invert('MessageType');
invert('StatementContext');
invert('SessionContext');
invert('TypeCode');
invert('FunctionCode');
invert('PartKind');
invert('SegmentKind');

function invert(name) {
  /*jshint forin: false */
  var source = exports[name];
  var target = {};
  for (var key in source) {
    target[source[key]] = key;
  }
  exports[name + 'Name'] = target;
}

util.extend(exports, require('./Constants'));
},{"../../util":242,"./ClientDistributionMode":184,"./CommandOption":185,"./CommitOption":186,"./ConnectOption":187,"./ConnectOptionType":188,"./Constants":189,"./DataFormatVersion":190,"./DistributionProtocolVersion":191,"./ErrorLevel":192,"./FunctionCode":193,"./IoType":194,"./LobOptions":195,"./LobSourceType":196,"./MessageType":197,"./NormalizedTypeCode":198,"./ParameterMode":199,"./PartKind":200,"./ReadFunction":201,"./ResultSetAttributes":202,"./SegmentKind":203,"./SessionContext":204,"./StatementContext":205,"./StatementContextType":206,"./TopologyInformation":207,"./TransactionFlag":208,"./TypeCode":209}],211:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

exports.read = read;
exports.write = write;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  return part.buffer;
}

function write(part, value) {
  /* jshint validthis:true */

  value = value || this;
  part = part || {};
  part.argumentCount = getArgumentCount(value);
  part.buffer = value;
  return part;
}

function getByteLength(value) {
  return value.length;
}

function getArgumentCount(value) {
  /* jshint unused:false */
  return 1;
}
},{}],212:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');

exports.read = read;
exports.write = write;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  return part;
}

function write(part, sourcePart) {
  /* jshint validthis:true */

  sourcePart = sourcePart || this;
  part = part || {};
  return util.extend(part, sourcePart);
}

function getByteLength(part) {
  return part.length;
}

function getArgumentCount(part) {
  /* jshint unused:false */
  return part.argumentCount;
}
},{"../../util":242}],213:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');

exports.read = read;
exports.write = write;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  var offset = 0;
  var buffer = part.buffer;
  var fields = [];

  var numberOfFields = buffer.readUInt16LE(offset);
  offset += 2;
  var fieldLength;
  for (var i = 0; i < numberOfFields; i++) {
    fieldLength = buffer[offset];
    offset += 1;
    if (fieldLength > 245) {
      fieldLength = buffer.readUInt16LE(offset);
      offset += 2;
    }
    fields.push(buffer.slice(offset, offset + fieldLength));
    offset += fieldLength;
  }
  return fields;
}

function write(part, fields) {
  /* jshint validthis:true */

  var offset = 0;
  part = part || {};
  fields = fields || this;

  var byteLength = getByteLength(fields);
  var buffer = new Buffer(byteLength);

  buffer.writeUInt16LE(fields.length, 0);
  offset += 2;

  var field, fieldLength, data;
  for (var i = 0; i < fields.length; i++) {
    field = fields[i];
    if (Buffer.isBuffer(field)) {
      data = field;
    } else if (util.isArray(field)) {
      data = write({}, field).buffer;
    } else {
      data = new Buffer(field, 'ascii');
    }
    fieldLength = data.length;
    if (fieldLength <= 245) {
      buffer[offset] = fieldLength;
      offset += 1;
    } else {
      buffer[offset] = 0xf6;
      offset += 1;
      buffer.writeUInt16LE(fieldLength, offset);
      offset += 2;
    }
    data.copy(buffer, offset);
    offset += fieldLength;
  }
  part.argumentCount = getArgumentCount(fields);
  part.buffer = buffer;
  return part;
}

function getByteLength(fields) {
  var byteLength = 2;
  var fieldLength;
  for (var i = 0; i < fields.length; i++) {
    fieldLength = getByteLengthOfField(fields[i]);
    if (fieldLength <= 245) {
      byteLength += fieldLength + 1;
    } else {
      byteLength += fieldLength + 3;
    }
  }
  return byteLength;
}

function getArgumentCount(fields) {
  /* jshint unused:false */
  return 1;
}

function getByteLengthOfField(field) {
  if (Buffer.isBuffer(field)) {
    return field.length;
  } else if (util.isArray(field)) {
    return getByteLength(field);
  }
  return Buffer.byteLength(field, 'ascii');
}
}).call(this,require("buffer").Buffer)
},{"../../util":242,"buffer":"buffer"}],214:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

exports.read = read;
exports.write = write;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  if (part.argumentCount === 1) {
    return part.buffer.readInt32LE(0);
  }
  var offset = 0;
  var buffer = part.buffer;
  var args = [];
  for (var i = 0; i < part.argumentCount; i++) {
    args.push(buffer.readInt32LE(offset));
    offset += 4;
  }
  return args;
}

function write(part, value) {
  /* jshint validthis:true */

  part = part || {};
  part.argumentCount = getArgumentCount(value);
  part.buffer = new Buffer(4);
  part.buffer.writeInt32LE(value, 0);
  return part;
}

function getByteLength(value) {
  /* jshint unused:false */
  return 4;
}

function getArgumentCount(value) {
  /* jshint unused:false */
  return 1;
}
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],215:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var opts = require('./Options');
var getByteLengthOfOptions = opts.getByteLength;
var writeOptions = opts.write;
var readOptions = opts._read;

exports.read = read;
exports.write = write;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  var offset = 0;
  var buffer = part.buffer;
  var lines = [];
  var numberOfOptions, options;
  for (var i = 0; i < part.argumentCount; i++) {
    numberOfOptions = buffer.readInt16LE(offset);
    offset += 2;
    options = new Array(numberOfOptions);
    offset = readOptions.call(options, buffer, offset);
    lines.push(options);
  }
  return lines;
}

function write(part, lines) {
  /* jshint validthis:true */

  var offset = 0;
  lines = lines || this;
  part = part || {};
  var byteLength = getByteLength(lines);
  var buffer = new Buffer(byteLength);
  var options;
  for (var i = 0; i < lines.length; i++) {
    options = writeOptions({}, lines[i]);
    buffer.writeInt16LE(options.argumentCount, offset);
    offset += 2;
    options.buffer.copy(buffer, offset);
    offset += options.buffer.length;
  }
  part.argumentCount = getArgumentCount(lines);
  part.buffer = buffer;
  return part;
}

function getByteLength(lines) {
  var byteLength = 0;

  for (var i = 0; i < lines.length; i++) {
    byteLength += 2 + getByteLengthOfOptions(lines[i]);
  }
  return byteLength;
}

function getArgumentCount(lines) {
  /* jshint unused:false */
  return lines.length;
}
}).call(this,require("buffer").Buffer)
},{"./Options":216,"buffer":"buffer"}],216:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');
var bignum = util.bignum;
var common = require('../common');
var TypeCode = common.TypeCode;

exports.read = read;
exports.toObject = toObject;
exports._read = _read;
exports.write = write;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function read(part, properties) {
  var options = new Array(part.argumentCount);
  _read.call(options, part.buffer, 0);
  if (util.isObject(properties)) {
    return toObject(options, properties);
  }
  return options;
}

function toObject(options, properties) {
  var obj = {};

  function setOption(option) {
    var name = option.name;
    if (properties.hasOwnProperty(name)) {
      var propertyName = util._2cc(properties[name]);
      obj[propertyName] = option.value;
    }
  }
  options.forEach(setOption);
  return obj;
}

function _read(buffer, offset) {
  /* jshint validthis:true */

  offset = offset || 0;
  var options = this;
  var option, length;
  for (var i = 0; i < options.length; i++) {
    option = {
      name: buffer[offset],
      type: buffer[offset + 1],
      value: undefined
    };
    offset += 2;
    switch (option.type) {
    case TypeCode.BOOLEAN:
      option.value = buffer[offset] ? true : false;
      offset += 1;
      break;
    case TypeCode.INT:
      option.value = buffer.readInt32LE(offset);
      offset += 4;
      break;
    case TypeCode.BIGINT:
      option.value = bignum.readInt64LE(buffer, offset);
      offset += 8;
      break;
    case TypeCode.DOUBLE:
      option.value = buffer.readDoubleLE(offset);
      offset += 8;
      break;
    case TypeCode.STRING:
      length = buffer.readInt16LE(offset);
      offset += 2;
      option.value = buffer.toString('utf-8', offset, offset + length);
      offset += length;
      break;
    case TypeCode.BSTRING:
      length = buffer.readInt16LE(offset);
      offset += 2;
      option.value = new Buffer(length);
      buffer.copy(option.value, 0, offset, offset + length);
      offset += length;
      break;
    }
    options[i] = option;
  }
  return offset;
}

function write(part, options) {
  /* jshint validthis:true */

  var offset = 0;
  part = part || {};
  options = options || this;
  var byteLength = getByteLength(options);
  var buffer = new Buffer(byteLength);
  var option;
  for (var i = 0; i < options.length; i++) {
    option = options[i];
    buffer[offset] = option.name;
    buffer[offset + 1] = option.type;
    offset += 2;
    switch (option.type) {
    case TypeCode.BOOLEAN:
      buffer[offset] = !!option.value ? 1 : 0;
      offset += 1;
      break;
    case TypeCode.INT:
      buffer.writeInt32LE(option.value, offset);
      offset += 4;
      break;
    case TypeCode.BIGINT:
      buffer.writeInt64LE(option.value, offset);
      offset += 8;
      break;
    case TypeCode.DOUBLE:
      buffer.writeDoubleLE(option.value, offset);
      offset += 8;
      break;
    case TypeCode.STRING:
      byteLength = Buffer.byteLength(option.value, 'utf-8');
      buffer.writeInt16LE(byteLength, offset);
      offset += 2;
      buffer.write(option.value, offset, byteLength, 'utf-8');
      offset += byteLength;
      break;
    case TypeCode.BSTRING:
      byteLength = option.value.length;
      buffer.writeInt16LE(byteLength, offset);
      offset += 2;
      option.value.copy(buffer, offset);
      offset += byteLength;
      break;
    }
  }
  part.argumentCount = options.length;
  part.buffer = buffer;
  return part;
}

function getByteLength(options) {
  var byteLength = 0;
  var option;
  for (var i = 0; i < options.length; i++) {
    option = options[i];
    switch (option.type) {
    case TypeCode.BOOLEAN:
      byteLength += 3;
      break;
    case TypeCode.INT:
      byteLength += 6;
      break;
    case TypeCode.BIGINT:
      byteLength += 10;
      break;
    case TypeCode.DOUBLE:
      byteLength += 10;
      break;
    case TypeCode.STRING:
      byteLength += 4 + Buffer.byteLength(option.value, 'utf-8');
      break;
    case TypeCode.BSTRING:
      byteLength += 4 + option.value.length;
      break;
    }
  }
  return byteLength;
}

function getArgumentCount(options) {
  return options.length;
}
}).call(this,require("buffer").Buffer)
},{"../../util":242,"../common":210,"buffer":"buffer"}],217:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var common = require('../common');
var ParameterMode = common.ParameterMode;

exports.read = read;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  var params = new Array(part.argumentCount);
  _read.call(params, part.buffer, 0);
  return params;
}

function _read(buffer, offset) {
  /* jshint validthis:true */

  offset = offset || 0;
  var params = this;
  var textOffset = offset + params.length * 16;
  for (var i = 0; i < params.length; i++) {
    params[i] = new Parameter(buffer, offset, textOffset);
    offset += 16;
  }
  return offset;
}

function getArgumentCount(params) {
  /* jshint unused:false */
  return params.length;
}

function Parameter(buffer, offset, textOffset) {
  this.mode = buffer[offset];
  this.dataType = buffer[offset + 1];
  this.ioType = buffer[offset + 2];
  var nameOffset = buffer.readInt32LE(offset + 4);
  if (nameOffset < 0) {
    this.name = undefined;
  } else {
    var start = textOffset + nameOffset;
    var length = buffer[start];
    start += 1;
    this.name = buffer.toString('utf-8', start, start + length);
  }
  this.length = buffer.readInt16LE(offset + 8);
  this.fraction = buffer.readInt16LE(offset + 10);
}

Parameter.prototype.isReadOnly = function isReadOnly() {
  /* jshint bitwise:false */
  return this.mode & ParameterMode.READONLY ? true : false;
};

Parameter.prototype.isMandatory = function isMandatory() {
  /* jshint bitwise:false */
  return this.mode & ParameterMode.MANDATORY ? true : false;
};

Parameter.prototype.isAutoIncrement = function isAutoIncrement() {
  /* jshint bitwise:false */
  return this.mode & ParameterMode.AUTO_INCREMENT ? true : false;
};
},{"../common":210}],218:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

exports.write = write;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function write(part, value) {
  /* jshint validthis:true */

  value = value || this;
  part = part || {};
  if (Array.isArray(value)) {
    part.argumentCount = value.length;
    part.buffer = Buffer.concat(value);
    return part;
  }
  if (Buffer.isBuffer(value)) {
    part.argumentCount = 1;
    part.buffer = value;
    return part;
  }
}

function getByteLength(value) {
  if (Array.isArray(value)) {
    var byteLength = 0;
    for (var i = 0; i < value.length; i++) {
      byteLength += value[i].length;
    }
    return byteLength;
  }
  if (Buffer.isBuffer(value)) {
    return value.length;
  }
}

function getArgumentCount(value) {
  /* jshint unused:false */
  if (Array.isArray(value)) {
    return value.length;
  }
  if (Buffer.isBuffer(value)) {
    return 1;
  }
}
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],219:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var common = require('../common');
var LobOptions = common.LobOptions;

exports.read = read;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  var offset = 0;
  var buffer = part.buffer;

  var locatorId = buffer.slice(offset, offset + 8);
  offset += 8;
  var options = buffer[offset];
  offset += 1;
  var length = buffer.readInt32LE(offset);
  offset = 16;
  var chunk = buffer.slice(offset, offset + length);
  offset += length;
  return new ReadLobReply(locatorId, options, chunk);
}

function getByteLength(chunk) {
  return 16 + chunk.length;
}

function getArgumentCount(value) {
  /* jshint unused:false */
  return 1;
}

function ReadLobReply(locatorId, options, chunk) {
  this.locatorId = locatorId;
  this.options = options;
  this.chunk = chunk;
}

Object.defineProperties(ReadLobReply.prototype, {
  isNull: {
    get: function isNull() {
      /* jshint bitwise:false */
      return !!(this.options & LobOptions.NULL_INDICATOR);
    }
  },
  isDataIncluded: {
    get: function isDataIncluded() {
      /* jshint bitwise:false */
      return !!(this.options & LobOptions.DATA_INCLUDED);
    }
  },
  isLast: {
    get: function isLast() {
      /* jshint bitwise:false */
      return !!(this.options & LobOptions.LAST_DATA);
    }
  }
});
},{"../common":210}],220:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');
var bignum = util.bignum;

var READ_LOB_REQUEST_LENGTH = 24;

exports.write = write;
exports.read = read;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function write(part, req) {
  /* jshint validthis:true */

  var offset = 0;
  part = part || {};
  req = req || this;

  var buffer = new Buffer(READ_LOB_REQUEST_LENGTH);
  if (Buffer.isBuffer(req.locatorId)) {
    req.locatorId.copy(buffer, offset, 0, 8);
  } else {
    bignum.writeInt64LE(buffer, req.locatorId, offset);
  }
  offset += 8;
  bignum.writeInt64LE(buffer, req.offset, offset);
  offset += 8;
  buffer.writeInt32LE(req.length, offset);
  offset += 4;
  buffer.fill(0x00, offset);
  part.argumentCount = getArgumentCount(req);
  part.buffer = buffer;
  return part;
}

function read(part) {
  var buffer = part.buffer;
  var locatorId = new Buffer(8);
  buffer.copy(locatorId, 0);
  return {
    locatorId: locatorId,
    offset: bignum.readInt64LE(buffer, 8),
    length: buffer.readInt32LE(16)
  };
}

function getByteLength(req) {
  /* jshint unused:false */
  return READ_LOB_REQUEST_LENGTH;
}

function getArgumentCount(req) {
  /* jshint unused:false */
  return 1;
}
}).call(this,require("buffer").Buffer)
},{"../../util":242,"buffer":"buffer"}],221:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var common = require('../common');
var ParameterMode = common.ParameterMode;
var READONLY = ParameterMode.READONLY;
var AUTO_INCREMENT = ParameterMode.AUTO_INCREMENT;
var MANDATORY = ParameterMode.MANDATORY;

exports.read = read;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  var columns = new Array(part.argumentCount);
  var offset = 0;
  var textOffset = columns.length * 24;
  for (var i = 0; i < columns.length; i++) {
    columns[i] = readColumn(part.buffer, offset, textOffset);
    offset += 24;
  }
  return columns;
}

function getArgumentCount(columns) {
  /* jshint unused:false */
  return columns.length;
}

var COLUMN_NAME_PROPERTIES = [
  'tableName', 'schemaName', 'columnName', 'columnDisplayName'
];

function readColumn(buffer, offset, textOffset) {
  var column = new Column(
    buffer.readInt8(offset),
    buffer.readInt8(offset + 1),
    buffer.readInt16LE(offset + 2),
    buffer.readInt16LE(offset + 4)
  );
  offset += 8;

  function readName(name) {
    var start = buffer.readInt32LE(offset);
    offset += 4;
    if (start < 0) {
      column[name] = undefined;
    } else {
      start += textOffset;
      var length = buffer.readUInt8(start);
      start += 1;
      column[name] = buffer.toString('utf-8', start, start + length);
    }
  }
  COLUMN_NAME_PROPERTIES.forEach(readName);
  return column;
}

function Column(mode, dataType, fraction, length) {
  this.mode = mode;
  this.dataType = dataType;
  this.fraction = fraction;
  this.length = length;
  this.tableName = undefined;
  this.schemaName = undefined;
  this.columnName = undefined;
  this.columnDisplayName = undefined;
}

Column.prototype.isReadOnly = function isReadOnly() {
  /* jshint bitwise:false */
  return this.mode & READONLY ? true : false;
};

Column.prototype.isMandatory = function isMandatory() {
  /* jshint bitwise:false */
  return this.mode & MANDATORY ? true : false;
};

Column.prototype.isAutoIncrement = function isAutoIncrement() {
  /* jshint bitwise:false */
  return this.mode & AUTO_INCREMENT ? true : false;
};
},{"../common":210}],222:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');
var ErrorLevel = require('../common/ErrorLevel');

exports.read = read;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  var err = new SqlError();
  _read.call(err, part.buffer, 0);
  return err;
}

function _read(buffer, offset) {
  /* jshint validthis:true */

  offset = offset || 0;
  this.code = buffer.readInt32LE(offset);
  offset += 4;
  this.position = buffer.readInt32LE(offset);
  offset += 4;
  var length = buffer.readInt32LE(offset);
  offset += 4;
  this.level = buffer.readInt8(offset);
  if (this.level === ErrorLevel.FATAL) {
    this.fatal = true;
  }
  offset += 1;
  this.sqlState = buffer.toString('ascii', offset, offset + 5);
  offset += 5;
  this.message = buffer.toString('utf-8', offset, offset + length);
  offset += util.alignLength(length, 8);
  return offset;
}

function getByteLength(err) {
  return 18 + Buffer.byteLength(err.message);
}

function getArgumentCount(err) {
  /* jshint unused:false */
  return 1;
}

util.inherits(SqlError, Error);

function SqlError() {
  Error.call(this);

  this.message = undefined;
  this.code = undefined;
  this.sqlState = undefined;
  this.level = undefined;
  this.position = undefined;
}
}).call(this,require("buffer").Buffer)
},{"../../util":242,"../common/ErrorLevel":192,"buffer":"buffer"}],223:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

exports.read = read;
exports.write = write;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  return part.buffer.toString('utf-8');
}

function write(part, value) {
  /* jshint validthis:true */

  value = value || this;
  part = part || {};
  part.argumentCount = getArgumentCount(value);
  part.buffer = new Buffer(value, 'utf-8');
  return part;
}

function getByteLength(value) {
  return Buffer.byteLength(value);
}

function getArgumentCount(value) {
  /* jshint unused:false */
  return 1;
}
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],224:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

exports.read = read;
exports.write = write;
exports.getByteLength = getByteLength;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  return part.buffer.slice(1).toString('utf-8');
}

function write(part, value) {
  /* jshint validthis:true */

  value = value || this;
  part = part || {};
  part.argumentCount = getArgumentCount(value);
  part.buffer = new Buffer(' ' + value, 'utf-8');
  return part;
}

function getByteLength(value) {
  return Buffer.byteLength(value) + 1;
}

function getArgumentCount(value) {
  /* jshint unused:false */
  return 1;
}
}).call(this,require("buffer").Buffer)
},{"buffer":"buffer"}],225:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';


var Options = require('./Options');
var common = require('../common');

exports.read = read;
exports.getByteLength = Options.getByteLength;
exports.getArgumentCount = Options.getArgumentCount;

function read(part) {
  return Options.read(part, common.TransactionFlagName);
}
},{"../common":210,"./Options":216}],226:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

exports.read = read;
exports.getArgumentCount = getArgumentCount;

function read(part) {
  var offset = 0;
  var buffer = part.buffer;
  var args = [];
  for (var i = 0; i < part.argumentCount; i++) {
    args.push(buffer.slice(offset, offset + 8));
    offset += 8;
  }
  return args;
}

function getArgumentCount(args) {
  return args.length;
}
},{}],227:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var common = require('../common');
var PartKind = common.PartKind;

var Binary = require('./Binary');
var Default = require('./Default');
var Fields = require('./Fields');
var Int32 = require('./Int32');
var MultilineOptions = require('./MultilineOptions');
var Options = require('./Options');
var ParameterMetadata = require('./ParameterMetadata');
var Parameters = require('./Parameters');
var ReadLobReply = require('./ReadLobReply');
var ReadLobRequest = require('./ReadLobRequest');
var ResultSetMetadata = require('./ResultSetMetadata');
var SqlError = require('./SqlError');
var Text = require('./Text');
var Text20 = require('./Text20');
var TransactionFlags = require('./TransactionFlags');
var WriteLobReply = require('./WriteLobReply');

var rw = module.exports = {};
rw[PartKind.AUTHENTICATION] = Fields;
rw[PartKind.COMMAND] = Text;
rw[PartKind.CLIENT_ID] = Text20;
rw[PartKind.CONNECT_OPTIONS] = Options;
rw[PartKind.COMMIT_OPTIONS] = Options;
rw[PartKind.ERROR] = SqlError;
rw[PartKind.FETCH_OPTIONS] = Options;
rw[PartKind.FETCH_SIZE] = Int32;
rw[PartKind.TRANSACTION_ID] = Binary;
rw[PartKind.TOPOLOGY_INFORMATION] = MultilineOptions;
rw[PartKind.PARAMETERS] = Parameters;
rw[PartKind.PARAMETER_METADATA] = ParameterMetadata;
rw[PartKind.RESULT_SET_ID] = Binary;
rw[PartKind.RESULT_SET] = Default;
rw[PartKind.OUTPUT_PARAMETERS] = Default;
rw[PartKind.RESULT_SET_METADATA] = ResultSetMetadata;
rw[PartKind.ROWS_AFFECTED] = Int32;
rw[PartKind.READ_LOB_REQUEST] = ReadLobRequest;
rw[PartKind.READ_LOB_REPLY] = ReadLobReply;
rw[PartKind.WRITE_LOB_REQUEST] = Default;
rw[PartKind.WRITE_LOB_REPLY] = WriteLobReply;
rw[PartKind.SESSION_CONTEXT] = Options;
rw[PartKind.STATEMENT_CONTEXT] = Options;
rw[PartKind.STATEMENT_ID] = Binary;
rw[PartKind.PARTITION_INFORMATION] = Default;
rw[PartKind.TRANSACTION_FLAGS] = TransactionFlags;
rw[PartKind.TABLE_NAME] = Text;

for (var name in PartKind) {
  /*jshint forin: false */
  var kind = PartKind[name];
  if (!rw[kind]) {
    rw[kind] = Default;
  }
}
},{"../common":210,"./Binary":211,"./Default":212,"./Fields":213,"./Int32":214,"./MultilineOptions":215,"./Options":216,"./ParameterMetadata":217,"./Parameters":218,"./ReadLobReply":219,"./ReadLobRequest":220,"./ResultSetMetadata":221,"./SqlError":222,"./Text":223,"./Text20":224,"./TransactionFlags":225,"./WriteLobReply":226}],228:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

exports.Connection = require('./Connection');
exports.Parser = require('./Parser');
exports.Result = require('./Result');
exports.ResultSet = require('./ResultSet');
exports.Statement = require('./Statement');
exports.Stringifier = require('./Stringifier');
exports.Transaction = require('./Transaction');
exports.Reader = require('./Reader');
exports.Writer = require('./Writer');
exports.ExecuteTask = require('./ExecuteTask');
exports.Lob = require('./Lob');
exports.auth = require('./auth');
exports.common = require('./common');
exports.data = require('./data');
exports.part = require('./part');
exports.reply = require('./reply');
exports.request = require('./request');
},{"./Connection":167,"./ExecuteTask":168,"./Lob":169,"./Parser":170,"./Reader":171,"./Result":172,"./ResultSet":173,"./Statement":175,"./Stringifier":176,"./Transaction":177,"./Writer":178,"./auth":183,"./common":210,"./data":227,"./part":232,"./reply":235,"./request":238}],229:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');

module.exports = AbstractOptions;

function AbstractOptions() {}

AbstractOptions.prototype.getOptions = function getOptions() {
  var self = this;

  function getOption(name) {
    var propertyName = util._2cc(self.PROPERTY_NAMES[name]);
    var value = self[propertyName];
    var type = self.TYPES[name];
    return {
      name: name,
      value: value,
      type: type
    };
  }
  return this.KEYS.map(getOption);
};

AbstractOptions.prototype.setOptions = function setOptions(options) {
  var self = this;

  if (!util.isArray(options)) {
    return;
  }

  function setOption(option) {
    var name = option.name;
    if (self.PROPERTY_NAMES.hasOwnProperty(name)) {
      var propertyName = util._2cc(self.PROPERTY_NAMES[name]);
      self[propertyName] = option.value;
    }
  }
  options.forEach(setOption);
};
},{"../../util":242}],230:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');
var AbstractOptions = require('./AbstractOptions');
var common = require('../common');

var DataFormatVersion = common.DataFormatVersion;
var ClientDistributionMode = common.ClientDistributionMode;
var DistributionProtocolVersion = common.DistributionProtocolVersion;

module.exports = ConnectOptions;

util.inherits(ConnectOptions, AbstractOptions);

function ConnectOptions() {
  AbstractOptions.call(this);

  // This field contains the connection ID.
  // It is filled by the server when the connection is established.
  // This number can be used in DISCONNECT / KILL commands for command
  // or session cancellation.
  this.connectionId = undefined;

  // This field is set if array commands continue to process
  // remaining input when detecting an error in an input row.
  // Always set for current client and server.
  this.completeArrayExecution = true;

  // The session locale can be set by the client.
  // The locale is used in language-dependent handling
  // within the SAP HANA database calculation engine.
  this.clientLocale = 'en_US';

  // This field is set by the server to process array commands.
  this.supportsLargeBulkOperations = undefined;

  // This field is set by the server to indicate
  // support of a large number of parameters.
  this.largeNumberOfParametersSupport = undefined;

  // This option is set by the server and filled with the SAPSYSTEMNAME
  // of the connected instance for tracing and supportability purposes.
  this.systemId = undefined;

  // This field is set by the client to indicate that the client is able
  // to handle the special function code for SELECT ... FOR UPDATE commands.
  this.selectForUpdateSupported = false;

  // This field is set by the client to indicate the mode for handling
  // statement routing and client distribution.
  // The server sets this field to the appropriate support level
  // depending on the client value and its own configuration.
  //
  // The following values are supported:
  // *  `0` OFF, no routing or distributed transaction handling is done.
  // *  `1` CONNECTION, client can connect to any (master/slave) server
  //        in the topology, and connections are enabled, such that the
  //        connection load on the nodes is balanced.
  // *  `2` STATEMENT, server returns information about which node is preferred
  //        for executing the statement, clients execute on that node,
  //        if possible.
  // *  `3` STATEMENT_CONNECTION, both STATEMENT and CONNECTION level
  this.clientDistributionMode = ClientDistributionMode.OFF;

  // The server sets this field to the maximum version it is able to support.
  // The possible values correspond to the `dataFormatVersion` property.
  this.engineDataFormatVersion = undefined;

  // This field is set by the client and indicates
  // the support level in the protocol for distribution features.
  // The server may choose to disable distribution if the support level
  // is not sufficient for the handling.
  // *  `0` BASE Baseline version
  // *  `1` Client handles statement sequence number information
  //        (statement context part handling).
  // `clientDistributionMode` is OFF if a value less than one
  // is returned by the server.
  this.distributionProtocolVersion = DistributionProtocolVersion.BASE;

  // This field is sent by the client and returned by the server
  // if configuration allows splitting batch (array)
  // commands for parallel execution.
  this.splitBatchCommands = true;

  // This field is sent by the server to indicate the client should gather the
  // state of the current transaction only from the `TRANSACTIONFLAGS` command,
  // not from the nature of the command (DDL, UPDATE, and so on).
  this.useTransactionFlagsOnly = undefined;

  // This field is sent by the server to indicate it ignores unknown parts
  // of the communication protocol instead of raising a fatal error.
  this.ignoreUnknownParts = undefined;

  // The client indicates this set of understood type codes and field formats.
  // The server then defines the value according to its own capabilities,
  // and sends it back. The following values are supported:
  // *  `1` Baseline data type support (SAP HANA SPS 02)
  // *  `4` Baseline data type support (SAP HANA SPS 06)
  //        Support for ALPHANUM, TEXT, SHORTTEXT, LONGDATE, SECONDDATE,
  //        DAYDATE, and SECONDTIME.
  this.dataFormatVersion = DataFormatVersion.COMPLETE_DATATYPE_SUPPORT;
  this.dataFormatVersion2 = DataFormatVersion.COMPLETE_DATATYPE_SUPPORT;
}

ConnectOptions.prototype.PROPERTY_NAMES = common.ConnectOptionName;
ConnectOptions.prototype.TYPES = common.ConnectOptionType;
ConnectOptions.prototype.KEYS = [
  common.ConnectOption.COMPLETE_ARRAY_EXECUTION,
  common.ConnectOption.CLIENT_LOCALE,
  common.ConnectOption.CLIENT_DISTRIBUTION_MODE,
  common.ConnectOption.DISTRIBUTION_PROTOCOL_VERSION,
  common.ConnectOption.SELECT_FOR_UPDATE_SUPPORTED,
  common.ConnectOption.SPLIT_BATCH_COMMANDS,
  common.ConnectOption.DATA_FORMAT_VERSION,
  common.ConnectOption.DATA_FORMAT_VERSION2
];
},{"../../util":242,"../common":210,"./AbstractOptions":229}],231:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');
var AbstractOptions = require('./AbstractOptions');
var common = require('../common');
var PART_HEADER_LENGTH = common.PART_HEADER_LENGTH;
module.exports = StatementContext;

util.inherits(StatementContext, AbstractOptions);

function StatementContext() {
  AbstractOptions.call(this);

  // Information on the statement sequence within the transaction
  this.statementSequenceInfo = undefined;
  // Time for statement execution on the server in nano seconds
  this.serverExecutionTime = 0;
}

Object.defineProperties(StatementContext.prototype, {
  size: {
    get: function getSize() {
      var statementSequenceInfoLength;
      if (this.statementSequenceInfo) {
        statementSequenceInfoLength = this.statementSequenceInfo.length;
      } else {
        statementSequenceInfoLength = 10;
      }
      return PART_HEADER_LENGTH + util.alignLength(4 +
        statementSequenceInfoLength, 8);
    }
  }
});

StatementContext.prototype.PROPERTY_NAMES = common.StatementContextName;
StatementContext.prototype.TYPES = common.StatementContextType;
StatementContext.prototype.KEYS = [
  common.StatementContext.STATEMENT_SEQUENCE_INFO
];
},{"../../util":242,"../common":210,"./AbstractOptions":229}],232:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

exports.ConnectOptions = require('./ConnectOptions');
exports.StatementContext = require('./StatementContext');
},{"./ConnectOptions":230,"./StatementContext":231}],233:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');
var common = require('../common');
var PartKind = common.PartKind;

var PART_HEADER_LENGTH = common.PART_HEADER_LENGTH;
var BIG_ARGUMENT_COUNT_INDICATOR = -1;

module.exports = Part;

function Part(kind, attributes, argumentCount, buffer, encoding) {
  this.kind = kind || PartKind.NIL;
  this.attributes = attributes || 0;
  this.argumentCount = argumentCount || 0;
  if (util.isString(buffer)) {
    this.buffer = new Buffer(buffer, encoding || 'hex');
  } else {
    this.buffer = buffer;
  }
}

Object.defineProperty(Part.prototype, 'byteLength', {
  get: function getByteLength() {
    var byteLength = PART_HEADER_LENGTH;
    if (Buffer.isBuffer(this.buffer)) {
      byteLength += util.alignLength(this.buffer.length, 8);
    }
    return byteLength;
  }
});

Part.create = createPart;
Part.read = readPart;

function createPart(buffer, offset) {
  var part = new Part();
  readPart.call(part, buffer, offset);
  return part;
}

function readPart(buffer, offset) {
  /* jshint validthis:true */
  offset = offset || 0;

  this.kind = buffer[offset];
  this.attributes = buffer[offset + 1];
  this.argumentCount = buffer.readInt16LE(offset + 2);
  if (this.argumentCount === BIG_ARGUMENT_COUNT_INDICATOR) {
    this.argumentCount = buffer.readInt32LE(offset + 4);
  }
  var length = buffer.readInt32LE(offset + 8);
  offset += PART_HEADER_LENGTH;
  if (length > 0) {
    this.buffer = new Buffer(length);
    buffer.copy(this.buffer, 0, offset, offset + length);
    offset += util.alignLength(length, 8);
  }
  return offset;
}

Part.prototype.toBuffer = function toBuffer(size) {
  var byteLength = util.alignLength(this.buffer.length, 8);
  var buffer = new Buffer(PART_HEADER_LENGTH + byteLength);
  // Part kind, specifies nature of part data
  buffer.writeInt8(this.kind, 0);
  // Further attributes of part
  buffer.writeInt8(this.attributes, 1);
  // Argument count, number of elements in part data.
  buffer.writeInt16LE(this.argumentCount, 2);
  // Argument count, number of elements in part data (only for some part kinds).
  buffer.writeInt32LE(0, 4);
  // Length of part buffer in bytes
  buffer.writeInt32LE(this.buffer.length, 8);
  // Length in packet remaining without this part.
  buffer.writeInt32LE(size, 12);
  this.buffer.copy(buffer, PART_HEADER_LENGTH);
  if (this.buffer.length < byteLength) {
    buffer.fill(0x00, PART_HEADER_LENGTH + this.buffer.length);
  }
  return buffer;
};

Part.prototype.inspect = function inspect(options) {
  var lines = [];
  options = options || {};
  var offset = new Buffer(options.indentOffset || 0);
  offset.fill(0x20);
  offset = offset.toString('ascii');
  var kindName = common.PartKindName[this.kind];
  lines.push(offset + '{\n');
  lines.push(offset + '  kind: PartKind.' + kindName + ',\n');
  lines.push(offset + '  argumentCount: ' + this.argumentCount + ',\n');
  lines.push(offset + '  attributes: ' + this.attributes + ',\n');
  if (Buffer.isBuffer(this.buffer)) {
    var length = this.buffer.length;
    var start, end, chunk;
    start = 0;
    var hexstr = [];
    while (start < length) {
      end = start + 32 > length ? length : start + 32;
      chunk = this.buffer.toString('hex', start, end);
      hexstr.push(offset + '    \'' + chunk + '\'');
      start = end;
    }
    lines.push(offset + '  buffer: new Buffer(\n');
    lines.push(hexstr.join(' +\n') + ', \'hex\')\n');
  } else {
    lines.push(offset + '  buffer: null\n');
  }
  lines.push(offset + '}');
  return lines.join('');
};
}).call(this,require("buffer").Buffer)
},{"../../util":242,"../common":210,"buffer":"buffer"}],234:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');
var Part = require('./Part');
var data = require('../data');
var common = require('../common');
var FunctionCode = common.FunctionCode;
var SegmentKind = common.SegmentKind;
var PartKindName = common.PartKindName;
var MAX_PACKET_SIZE = common.MAX_PACKET_SIZE;
var PACKET_HEADER_LENGTH = common.PACKET_HEADER_LENGTH;
var SEGMENT_HEADER_LENGTH = common.SEGMENT_HEADER_LENGTH;

module.exports = Segment;

function Segment(kind, functionCode) {
  this.kind = kind || SegmentKind.INVALID;
  this.functionCode = functionCode || FunctionCode.NIL;
  this.parts = [];
}

Segment.prototype.push = function push(part) {
  this.parts.push(part);
};

Segment.prototype.inspect = function inpsect() {
  var lines = [];
  var kindName = common.SegmentKindName[this.kind];
  var fcodeName = common.FunctionCodeName[this.functionCode];
  lines.push('{\n');
  lines.push('  kind: SegmentKind.' + kindName + ',\n');
  lines.push('  functionCode: FunctionCode.' + fcodeName + ',\n');
  lines.push('  parts: [\n');

  function inspectPart(part) {
    return part.inspect({
      indentOffset: 4
    });
  }
  lines.push(this.parts.map(inspectPart).join(',\n') + '\n');
  lines.push('  ]\n');
  lines.push('}\n');
  return lines.join('');
};
Segment.create = createSegment;

function createSegment(buffer, offset) {
  var segment = new Segment();
  readSegment.call(segment, buffer, offset);
  return segment;
}

Segment.read = readSegment;

function readSegment(buffer, offset) {
  /* jshint validthis:true */
  offset = offset || 0;

  var numberOfParts = buffer.readInt16LE(offset + 8);
  this.kind = buffer.readInt8(offset + 12);
  this.functionCode = buffer.readInt16LE(offset + 14);
  offset += SEGMENT_HEADER_LENGTH;
  for (var i = 0; i < numberOfParts; i++) {
    var part = new Part();
    offset = Part.read.call(part, buffer, offset);
    this.push(part);
  }
  return offset;
}

Segment.prototype.toBuffer = function toBuffer(size) {
  size = size || (MAX_PACKET_SIZE - PACKET_HEADER_LENGTH);
  var remainingSize = size - SEGMENT_HEADER_LENGTH;
  var length = SEGMENT_HEADER_LENGTH;
  var buffers = this.parts.map(function getPartBuffer(part) {
    var buffer = part.toBuffer(remainingSize);
    remainingSize -= buffer.length;
    length += buffer.length;
    return buffer;
  });

  var header = new Buffer(SEGMENT_HEADER_LENGTH);

  // Length of the segment, including the header
  header.writeInt32LE(length, 0);
  // Offset of the segment within the message buffer
  header.writeInt32LE(0, 4);
  // Number of contained parts
  header.writeInt16LE(this.parts.length, 8);
  // Number of segment within packet
  header.writeInt16LE(1, 10);
  // Segment kind
  header.writeInt8(this.kind, 12);
  // Filler
  header[13] = 0x00;
  // Function code
  header.writeInt16LE(this.functionCode, 14);
  // Filler
  header.fill(0x00, 16);

  buffers.unshift(header);
  return Buffer.concat(buffers, length);
};

Segment.prototype.getPart = function (kind) {
  var parts = this.parts.filter(function isKindOf(part) {
    return part.kind === kind;
  });
  if (parts.length === 1) {
    return parts[0];
  } else if (parts.length > 1) {
    return parts;
  }
  return null;
};

Segment.prototype.getReply = function getReply() {
  var reply = new Reply(this.kind, this.functionCode);
  for (var i = 0; i < this.parts.length; i++) {
    reply.add(this.parts[i]);
  }
  return reply;
};

function Reply(kind, functionCode) {
  this.kind = kind;
  this.functionCode = functionCode;
  this.resultSets = [];
}

Reply.prototype.addResultSetFragment = function addResultSetFragment(name,
  value) {
  var resultSet;
  if (this.resultSets.length) {
    resultSet = this.resultSets[this.resultSets.length - 1];
  }
  if (name === 'resultSet') {
    name = 'data';
  } else if (name === 'resultSetId') {
    name = 'id';
  } else if (name === 'resultSetMetadata') {
    name = 'metadata';
  }
  if (!resultSet || resultSet[name]) {
    resultSet = {};
    resultSet[name] = value;
    this.resultSets.push(resultSet);
  } else {
    resultSet[name] = value;
  }
};

Reply.prototype.add = function add(part) {
  var name = util._2cc(PartKindName[part.kind]);
  var value = data[part.kind].read(part);
  if (/^resultSet/.test(name) || name === 'tableName') {
    this.addResultSetFragment(name, value);
  } else if (util.isUndefined(this[name])) {
    this[name] = value;
  } else if (util.isArray(this[name])) {
    this[name].push(value);
  } else {
    var existingValue = this[name];
    this[name] = [existingValue, value];
  }
};
}).call(this,require("buffer").Buffer)
},{"../../util":242,"../common":210,"../data":227,"./Part":233,"buffer":"buffer"}],235:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

exports.Part = require('./Part');
exports.Segment = require('./Segment');
},{"./Part":233,"./Segment":234}],236:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');
var PartKind = require('../common/PartKind');

var PART_HEADER_LENGTH = 16;

module.exports = Part;

function Part(options) {
  this.kind = options.kind || PartKind.NIL;
  this.attributes = options.attributes || 0;
  this.argumentCount = options.argumentCount || 0;
  this.buffer = undefined;
}


Part.prototype.toBuffer = function toBuffer(size) {
  var byteLength = util.alignLength(this.buffer.length, 8);
  var buffer = new Buffer(PART_HEADER_LENGTH + byteLength);
  // Part kind, specifies nature of part data
  buffer.writeInt8(this.kind, 0);
  // Further attributes of part
  buffer.writeInt8(this.attributes, 1);
  // Argument count, number of elements in part data.
  buffer.writeInt16LE(this.argumentCount, 2);
  // Argument count, number of elements in part data (only for some part kinds).
  buffer.writeInt32LE(0, 4);
  // Length of part buffer in bytes
  buffer.writeInt32LE(this.buffer.length, 8);
  // Length in packet remaining without this part.
  buffer.writeInt32LE(size, 12);
  this.buffer.copy(buffer, PART_HEADER_LENGTH);
  if (this.buffer.length < byteLength) {
    buffer.fill(0x00, PART_HEADER_LENGTH + this.buffer.length);
  }
  return buffer;
};
}).call(this,require("buffer").Buffer)
},{"../../util":242,"../common/PartKind":200,"buffer":"buffer"}],237:[function(require,module,exports){
(function (Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');
var data = require('../data');
var common = require('../common');
var Part = require('./Part');
var MessageType = common.MessageType;
var SegmentKind = common.SegmentKind;

var MAX_SEGMENT_SIZE = common.MAX_PACKET_SIZE - common.PACKET_HEADER_LENGTH;
var SEGMENT_HEADER_LENGTH = common.SEGMENT_HEADER_LENGTH;

module.exports = Segment;

function Segment(type, commitImmediateley, commandOptions) {
  this.type = type || MessageType.NIL;
  this.commitImmediateley = !!commitImmediateley ? 1 : 0;
  this.commandOptions = commandOptions || 0;
  this.parts = [];
}

Segment.prototype.addPart = function addPart(part) {
  this.parts.push(part);
  return part;
};

Segment.prototype.push = function push(kind, args) {
  this.parts.push({
    kind: kind,
    args: args
  });
};

Segment.prototype.unshift = function unshift(kind, args) {
  this.parts.unshift({
    kind: kind,
    args: args
  });
};

Segment.prototype.add = function add(kind, args) {
  if (!args) {
    return;
  }
  if (util.isNumber(kind)) {
    this.parts.push({
      kind: kind,
      args: args
    });
    return;
  }
  if (util.isObject(kind)) {
    this.parts.push({
      kind: kind.kind,
      module: kind.module,
      args: args
    });
  }
};

Segment.prototype.toBuffer = function toBuffer(size) {
  size = size || MAX_SEGMENT_SIZE;
  var remainingSize = size - SEGMENT_HEADER_LENGTH;
  var length = SEGMENT_HEADER_LENGTH;
  var buffers = [];
  for (var i = 0; i < this.parts.length; i++) {
    var buffer = partToBuffer(this.parts[i], remainingSize);
    remainingSize -= buffer.length;
    length += buffer.length;
    buffers.push(buffer);
  }

  var header = new Buffer(SEGMENT_HEADER_LENGTH);
  // Length of the segment, including the header
  header.writeInt32LE(length, 0);
  // Offset of the segment within the message buffer
  header.writeInt32LE(0, 4);
  // Number of contained parts
  header.writeInt16LE(this.parts.length, 8);
  // Number of segment within packet
  header.writeInt16LE(1, 10);
  // Segment kind
  header.writeInt8(SegmentKind.REQUEST, 12);
  // Message type
  header.writeInt8(this.type, 13);
  // Whether the command shall be committed
  header.writeInt8(this.commitImmediateley, 14);
  // Command options
  header.writeInt8(this.commandOptions, 15);
  // Filler
  header.fill(0x00, 16, SEGMENT_HEADER_LENGTH);

  buffers.unshift(header);
  return Buffer.concat(buffers, length);
};

function partToBuffer(pd, remainingSize) {
  var m = pd.module || data[pd.kind];
  var part = new Part({
    kind: pd.kind
  });
  part.argumentCount = m.getArgumentCount(pd.args);
  m.write(part, pd.args, remainingSize);
  return part.toBuffer(remainingSize);
}
}).call(this,require("buffer").Buffer)
},{"../../util":242,"../common":210,"../data":227,"./Part":236,"buffer":"buffer"}],238:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('../../util');
var Segment = require('./Segment');
var Part = require('./Part');
var common = require('../common');
var MessageType = common.MessageType;
var PartKind = common.PartKind;
var TypeCode = common.TypeCode;
var CommandOption = common.CommandOption;
var CommitOption = common.CommitOption;

exports.Segment = Segment;
exports.Part = Part;
exports.authenticate = authenticate;
exports.connect = connect;
exports.disconnect = disconnect;
exports.executeDirect = executeDirect;
exports.prepare = prepare;
exports.execute = execute;
exports.fetchNext = fetchNext;
exports.closeResultSet = closeResultSet;
exports.dropStatementId = dropStatementId;
exports.readLob = readLob;
exports.writeLob = writeLob;
exports.commit = commit;
exports.rollback = rollback;

function createSegment(type, options) {
  options = options || {};
  var commitImmediateley = 0;
  var commandOptions = 0;
  switch (type) {
  case MessageType.EXECUTE:
  case MessageType.EXECUTE_DIRECT:
    commitImmediateley = getCommitImmediateley(options, 1);
    commandOptions = getCommandOptions(options);
    break;
  case MessageType.FETCH_NEXT:
  case MessageType.READ_LOB:
    commitImmediateley = getCommitImmediateley(options, 1);
    break;
  case MessageType.PREPARE:
    commandOptions = getCommandOptions(options);
    break;
  }
  var segment = new Segment(type, commitImmediateley, commandOptions);
  return segment;
}

function getCommitImmediateley(options, defaultValue) {
  /* jshint bitwise:false */
  var commitImmediateley = defaultValue;
  if (!util.isUndefined(options.autoCommit)) {
    commitImmediateley = ~~options.autoCommit;
  } else if (!util.isUndefined(options.commitImmediateley)) {
    commitImmediateley = ~~options.commitImmediateley;
  }
  return commitImmediateley;
}

function getCommandOptions(options) {
  /* jshint bitwise:false */
  var commandOptions = 0;
  if (options.scrollableCursor) {
    commandOptions |= CommandOption.SCROLLABLE_CURSOR_ON;
  }
  if (options.holdCursorsOverCommit) {
    commandOptions |= CommandOption.HOLD_CURSORS_OVER_COMMIT;
  }
  return commandOptions;
}

function authenticate(options) {
  var segment = createSegment(MessageType.AUTHENTICATE, options);
  // authentication
  segment.add(PartKind.AUTHENTICATION, options.authentication);
  return segment;
}

function connect(options) {
  var segment = createSegment(MessageType.CONNECT, options);
  // authentication
  segment.add(PartKind.AUTHENTICATION, options.authentication);
  // clientId
  segment.add(PartKind.CLIENT_ID, options.clientId);
  // connectOptions
  segment.add(PartKind.CONNECT_OPTIONS, options.connectOptions);
  return segment;
}

function disconnect(options) {
  var segment = createSegment(MessageType.DISCONNECT, options);
  return segment;
}

function closeResultSet(options) {
  var segment = createSegment(MessageType.CLOSE_RESULT_SET, options);
  // resultSetId
  segment.add(PartKind.RESULT_SET_ID, options.resultSetId);
  return segment;
}

function dropStatementId(options) {
  var segment = createSegment(MessageType.DROP_STATEMENT_ID, options);
  // statementId
  segment.add(PartKind.STATEMENT_ID, options.statementId);
  return segment;
}

function commit(options) {
  var segment = createSegment(MessageType.COMMIT, options);
  // commitOptions
  addCommitOptions(segment, options);
  return segment;
}

function rollback(options) {
  var segment = createSegment(MessageType.ROLLBACK, options);
  // commitOptions
  addCommitOptions(segment, options);
  return segment;
}

function fetchNext(options) {
  var segment = createSegment(MessageType.FETCH_NEXT, options);
  // resultSetId
  segment.add(PartKind.RESULT_SET_ID, options.resultSetId);
  // fetchSize
  segment.add(PartKind.FETCH_SIZE, options.fetchSize);
  return segment;
}

function readLob(options) {
  var segment = createSegment(MessageType.READ_LOB, options);
  // readLobRequest
  segment.add(PartKind.READ_LOB_REQUEST, options.readLobRequest);
  return segment;
}

function writeLob(options) {
  var segment = createSegment(MessageType.WRITE_LOB);
  // writeLobRequest
  segment.add(PartKind.WRITE_LOB_REQUEST, options.writeLobRequest);
  return segment;
}

function execute(options) {
  var segment = createSegment(MessageType.EXECUTE, options);
  // statementId
  segment.add(PartKind.STATEMENT_ID, options.statementId);
  // parameters
  segment.add(PartKind.PARAMETERS, options.parameters);
  return segment;
}

function executeDirect(options) {
  var segment = createSegment(MessageType.EXECUTE_DIRECT, options);
  // command
  segment.add(PartKind.COMMAND, options.command);
  return segment;
}

function prepare(options) {
  var segment = createSegment(MessageType.PREPARE, options);
  // command
  segment.add(PartKind.COMMAND, options.command);
  return segment;
}

function addCommitOptions(segment, options) {
  if (options.holdCursorsOverCommit) {
    var commitOptions = [{
      name: CommitOption.HOLD_CURSORS_OVER_COMMIT,
      type: TypeCode.BOOLEAN,
      value: 1
    }];
    segment.add(PartKind.COMMIT_OPTIONS, commitOptions);
  }
  return segment;
}
},{"../../util":242,"../common":210,"./Part":236,"./Segment":237}],239:[function(require,module,exports){
(function (process){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;

module.exports = Queue;

util.inherits(Queue, EventEmitter);

function Queue(immediate) {
  EventEmitter.call(this);

  this.queue = [];
  this.busy = false;
  this.running = !!immediate;
}

Object.defineProperty(Queue.prototype, 'empty', {
  get: function isEmpty() {
    return this.queue.length === 0;
  }
});

Queue.prototype.unshift = function unshift(task) {
  this.queue.unshift(task);
  if (this.running) {
    this.dequeue();
  }
  return this;
};

Queue.prototype.push = function push(task) {
  this.queue.push(task);
  if (this.running) {
    this.dequeue();
  }
  return this;
};

Queue.prototype.resume = function resume() {
  this.running = true;
  if (this.queue.length) {
    this.dequeue();
  }
  return this;
};

Queue.prototype.pause = function pause() {
  this.running = false;
  return this;
};

Queue.prototype.abort = function abort() {
  this.queue = [];
  this.busy = false;
  this.running = false;
  this.removeAllListeners();
  return this;
};

Queue.prototype.createTask = function createTask(send, receive, name) {
  return new Task(send, receive, name);
};

Queue.prototype.dequeue = function dequeue() {
  var self = this;

  function next(err, name) {
    /* jshint unused:false */
    self.busy = false;
    if (err instanceof Error) {
      self.pause();
      self.emit('error', err);
    }
    if (self.queue.length) {
      run();
    } else {
      self.emit('drain');
    }
  }

  function run() {
    if (self.running && !self.busy) {
      // Queue is running and not busy
      self.busy = true;
      var task = self.queue.shift();
      task.run(next);
    }
  }
  run();
};

function Task(send, receive, name) {
  this.send = send;
  this.receive = receive;
  this.name = name;
}

Task.prototype.run = function run(next) {
  var self = this;

  function receive() {
    /* jshint validthis:true */
    self.receive.apply(null, arguments);
    next(null, self.name);
  }
  try {
    this.send(receive);
  } catch (err) {
    process.nextTick(function () {
      receive(err);
    });
  }
};
}).call(this,require('_process'))
},{"_process":147,"events":142,"util":162}],240:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';
/* jshint bitwise:false */

var zeropad = require('./zeropad');

var BASE = Math.pow(10, 7);

var EXP_BIAS = 6176;

var INT_2_16 = Math.pow(2, 16);
var INT_2_21 = Math.pow(2, 21);
var INT_2_32 = Math.pow(2, 32);

/* 2^32 = 429 4967296 */
var INT_2_32_0 = 4967296;
var INT_2_32_1 = 429;

/* 2^53 = 90 0719925 4740992 */
var INT_2_53_0 = 4740992;
var INT_2_53_1 = 719925;
var INT_2_53_2 = 90;

/* 2^64 = 184467 4407370 9551616 */
var INT_2_64_0 = 9551616;
var INT_2_64_1 = 4407370;
var INT_2_64_2 = 184467;

/* 10^7 for base 2^16 */
var BIN_10_7_0 = 38528;
var BIN_10_7_1 = 152;

/* 10^14 for base 2^16 */
var BIN_10_14_0 = 16384;
var BIN_10_14_1 = 4218;
var BIN_10_14_2 = 23283;

/* 10^21 for base 2^16 */
var BIN_10_21_0 = 0;
var BIN_10_21_1 = 56992;
var BIN_10_21_2 = 44485;
var BIN_10_21_3 = 13769;
var BIN_10_21_4 = 54;

/* 10^28 for base 2^16 */
var BIN_10_28_0 = 0;
var BIN_10_28_1 = 4096;
var BIN_10_28_2 = 609;
var BIN_10_28_3 = 15909;
var BIN_10_28_4 = 52830;
var BIN_10_28_5 = 8271;

/* 10^35 for base 2^16 */
var BIN_10_35_0 = 0;
var BIN_10_35_1 = 0;
var BIN_10_35_2 = 36840;
var BIN_10_35_3 = 11143;
var BIN_10_35_4 = 19842;
var BIN_10_35_5 = 29383;
var BIN_10_35_6 = 16993;
var BIN_10_35_7 = 19;

function _readInt64(buffer, offset, unsigned) {

  var x, y, s, y0, y1, x0, x1, x2;

  x = buffer[offset + 2] << 16;
  x |= buffer[offset + 1] << 8;
  x |= buffer[offset];
  x += buffer[offset + 3] << 24 >>> 0;
  offset += 4;

  y = buffer[offset + 2] << 16;
  y |= buffer[offset + 1] << 8;
  y |= buffer[offset];
  y += buffer[offset + 3] << 24 >>> 0;

  if (!unsigned && (y & 0x80000000)) {
    y = 0xffffffff - y;
    if (x === 0) {
      y += 1;
    } else {
      x = 0xffffffff - x + 1;
    }
    s = -1;
  } else {
    s = 1;
  }

  if (y === 0) {
    return s * x;
  }
  if (y < INT_2_21 || (y === INT_2_21 && x === 0)) {
    return s * (y * INT_2_32 + x);
  }

  if (x < BASE) {
    x0 = x % BASE;
    x1 = 0;
  } else {
    x0 = x % BASE;
    x1 = Math.floor(x / BASE);
  }

  if (y < BASE) {
    y0 = y % BASE;
    y1 = 0;
  } else {
    y0 = y % BASE;
    y1 = Math.floor(y / BASE);
  }

  x0 += y0 * INT_2_32_0;
  x1 += y0 * INT_2_32_1 + y1 * INT_2_32_0;
  x2 = y1 * INT_2_32_1;

  if (x0 >= BASE) {
    x1 += Math.floor(x0 / BASE);
    x0 %= BASE;
  }
  if (x1 >= BASE) {
    x2 += Math.floor(x1 / BASE);
    x1 %= BASE;
  }

  if (s === 1) {
    return '' + x2 + zeropad.lpad14(x1 * BASE + x0);
  }
  return '-' + x2 + zeropad.lpad14(x1 * BASE + x0);

}

function isUInt64(value) {
  if (typeof value === 'number') {
    return true;
  }
  if (value.length < 20) {
    return true;
  }
  if (value.length === 20 && value <= '18446744073709551616') {
    return true;
  }
  return false;
}

function writeDec128(buffer, value, offset) {
  offset = offset || 0;
  buffer.fill(0x00, offset, offset + 16);

  if (isUInt64(value.m)) {
    writeUInt64(buffer, value.m, offset);
  } else {
    writeUInt128(buffer, value.m, offset);
  }

  var e = EXP_BIAS + value.e;

  var e0 = e << 1;
  e0 &= 0xfe;
  e0 |= buffer[offset + 14] & 0x01;
  buffer[offset + 14] = e0;

  var e1 = e >> 7;
  if (value.s < 0) {
    e1 |= 0x80;
  }
  buffer[offset + 15] = e1;
}

function readDec128(buffer, offset) {

  var i, j, k, l, z0, z1, y0, y1, y2, x0, x1, x2, x3, x4;

  offset = offset || 0;

  if ((buffer[offset + 15] & 0x70) === 0x70) {
    return null;
  }

  i = buffer[offset + 2] << 16;
  i |= buffer[offset + 1] << 8;
  i |= buffer[offset];
  i += buffer[offset + 3] << 24 >>> 0;
  offset += 4;

  j = buffer[offset + 2] << 16;
  j |= buffer[offset + 1] << 8;
  j |= buffer[offset];
  j += buffer[offset + 3] << 24 >>> 0;
  offset += 4;

  k = buffer[offset + 2] << 16;
  k |= buffer[offset + 1] << 8;
  k |= buffer[offset];
  k += buffer[offset + 3] << 24 >>> 0;
  offset += 4;

  l = (buffer[offset + 2] & 0x01) << 16;
  l |= buffer[offset + 1] << 8;
  l |= buffer[offset];
  offset += 2;

  var dec = {
    s: (buffer[offset + 1] & 0x80) ? -1 : 1,
    m: undefined,
    e: ((((buffer[offset + 1] << 8) | buffer[offset]) & 0x7ffe) >> 1) -
      EXP_BIAS
  };

  if (k === 0 && l === 0) {
    if (j === 0) {
      dec.m = i;
      return dec;
    }
    if (j < INT_2_21 || (j === INT_2_21 && i === 0)) {
      dec.m = j * INT_2_32 + i;
      return dec;
    }
  }

  if (i < BASE) {
    x0 = i;
    x1 = 0;
  } else {
    x0 = i % BASE;
    x1 = Math.floor(i / BASE);
  }

  if (j < BASE) {
    x0 += j * INT_2_32_0;
    x1 += j * INT_2_32_1;
    x2 = 0;
  } else {
    z0 = j % BASE;
    z1 = Math.floor(j / BASE);
    x0 += z0 * INT_2_32_0;
    x1 += z0 * INT_2_32_1 + z1 * INT_2_32_0;
    x2 = z1 * INT_2_32_1;
  }

  if (k < BASE) {
    y0 = k;
    y1 = 0;
  } else {
    y0 = k % BASE;
    y1 = Math.floor(k / BASE);
  }

  if (l < BASE) {
    y0 += l * INT_2_32_0;
    y1 += l * INT_2_32_1;
    y2 = 0;
  } else {
    z0 = l % BASE;
    z1 = Math.floor(l / BASE);
    y0 += z0 * INT_2_32_0;
    y1 += z0 * INT_2_32_1 + z1 * INT_2_32_0;
    y2 = z1 * INT_2_32_1;
  }

  if (y0 >= BASE) {
    y1 += Math.floor(y0 / BASE);
    y0 %= BASE;
  }
  if (y1 >= BASE) {
    y2 += Math.floor(y1 / BASE);
    y1 %= BASE;
  }

  x0 += y0 * INT_2_64_0;
  x1 += y0 * INT_2_64_1 + y1 * INT_2_64_0;
  x2 += y0 * INT_2_64_2 + y1 * INT_2_64_1 + y2 * INT_2_64_0;
  x3 = y1 * INT_2_64_2 + y2 * INT_2_64_1;
  x4 = y2 * INT_2_64_2;

  if (x0 >= BASE) {
    x1 += Math.floor(x0 / BASE);
    x0 %= BASE;
  }
  if (x1 >= BASE) {
    x2 += Math.floor(x1 / BASE);
    x1 %= BASE;
  }
  if (x2 >= BASE) {
    x3 += Math.floor(x2 / BASE);
    x2 %= BASE;
  }
  if (x3 >= BASE) {
    x4 += Math.floor(x3 / BASE);
    x3 %= BASE;
  }

  if (x4) {
    dec.m = '' + x4 + zeropad.lpad14(x3 * BASE + x2) + zeropad.lpad14(x1 * BASE +
      x0);
    return dec;
  }
  if (x3) {
    dec.m = '' + (x3 * BASE + x2) + zeropad.lpad14(x1 * BASE + x0);
    return dec;
  }
  if (x2) {
    if (x2 < INT_2_53_2 || (x2 === INT_2_53_2 && (x1 < INT_2_53_1 || (x1 ===
      INT_2_53_1 && x0 <= INT_2_53_0)))) {
      dec.m = (x2 * BASE + x1) * BASE + x0;
      return dec;
    }
    dec.m = '' + x2 + zeropad.lpad14(x1 * BASE + x0);
    return dec;
  }
  dec.m = x1 * BASE + x0;
  return dec;

}

function readDecFloat(buffer, offset) {
  var value = readDec128(buffer, offset);
  if (value === null) {
    return null;
  }
  var d, l, e;
  d = '' + value.m;
  l = d.length;
  e = value.e + l - 1;
  if (e < 0) {
    e = 'e' + e;
  } else {
    e = 'e+' + e;
  }
  while (d.charCodeAt(l - 1) === 48) {
    l -= 1;
  }
  if (l > 1) {
    d = d.substring(0, 1) + '.' + d.substring(1, l);
  }
  if (value.s < 0) {
    return '-' + d + e;
  }
  return d + e;
}

function readDecFixed(buffer, offset, frac) {
  var value = readDec128(buffer, offset);
  if (value === null) {
    return null;
  }
  frac = frac || 0;
  var d, e, l, k, i, f;
  d = '' + value.m;
  e = value.e;
  if (e < 0) {
    l = d.length;
    k = l + e;
    if (k > 0) {
      i = d.substring(0, k);
      f = d.substring(k);
    } else if (k < 0) {
      i = '0';
      f = zeropad.ZEROS[-k] + d;
    } else {
      i = '0';
      f = d;
    }
  } else if (e > 0) {
    i = d + zeropad.ZEROS[e];
    f = '';
  } else {
    i = d;
    f = '';
  }
  if (value.s < 0) {
    i = '-' + i;
  }
  if (frac === 0) {
    return i;
  }
  l = f.length;
  if (l > frac) {
    f = f.substring(0, frac);
  } else if (l < frac) {
    f += zeropad.ZEROS[frac - l];
  }
  return i + '.' + f;
}


function _writeInt64(buffer, value, offset, unsigned) {

  var l, x, a, b, c, x0, x1, y0, y1, z0, z1, z2, z3;

  var negative = false;

  if (typeof value === 'string') {

    l = value.length;

    if (l > 15) {

      a = +value.substring(l - 7);
      b = +value.substring(l - 14, l - 7);
      c = +value.substring(0, l - 14);

      if (!unsigned && c < 0) {
        c *= -1;
        negative = true;
      }

      z0 = a % INT_2_16;
      z1 = Math.floor(a / INT_2_16);
      z2 = z3 = 0;

      y0 = b % INT_2_16;
      y1 = Math.floor(b / INT_2_16);

      z0 += y0 * BIN_10_7_0;
      z1 += y0 * BIN_10_7_1 + y1 * BIN_10_7_0;
      z2 += y1 * BIN_10_7_1;

      y0 = c % INT_2_16;
      y1 = Math.floor(c / INT_2_16);

      z0 += y0 * BIN_10_14_0;
      z1 += y0 * BIN_10_14_1 + y1 * BIN_10_14_0;
      z2 += y0 * BIN_10_14_2 + y1 * BIN_10_14_1;
      z3 += y1 * BIN_10_14_2;

      if (z0 >= INT_2_16) {
        z1 += Math.floor(z0 / INT_2_16);
        z0 %= INT_2_16;
      }
      if (z1 >= INT_2_16) {
        z2 += Math.floor(z1 / INT_2_16);
        z1 %= INT_2_16;
      }
      if (z2 >= INT_2_16) {
        z3 += Math.floor(z2 / INT_2_16);
        z2 %= INT_2_16;
      }

      x0 = z1 * INT_2_16 + z0;
      x1 = z3 * INT_2_16 + z2;

    } else {
      x = +value;

      if (!unsigned && x < 0) {
        x *= -1;
        negative = true;
      }

      x0 = x % INT_2_32;
      x1 = Math.floor(x / INT_2_32);
    }
  } else {
    x = value;

    if (!unsigned && x < 0) {
      x *= -1;
      negative = true;
    }

    x0 = x % INT_2_32;
    x1 = Math.floor(x / INT_2_32);
  }

  if (negative) {
    x1 = 0xffffffff - x1;
    if (x0 === 0) {
      x1 += 1;
    } else {
      x0 = 0xffffffff - x0 + 1;
    }
  }

  buffer[offset + 3] = (x0 >>> 24) & 0xff;
  buffer[offset + 2] = (x0 >>> 16) & 0xff;
  buffer[offset + 1] = (x0 >>> 8) & 0xff;
  buffer[offset] = x0 & 0xff;
  offset += 4;

  buffer[offset + 3] = (x1 >>> 24) & 0xff;
  buffer[offset + 2] = (x1 >>> 16) & 0xff;
  buffer[offset + 1] = (x1 >>> 8) & 0xff;
  buffer[offset] = x1 & 0xff;
}

function readUInt128(buffer, offset) {

  var i, j, k, l, z0, z1, y0, y1, y2, x0, x1, x2, x3, x4;

  offset = offset || 0;

  i = buffer[offset + 2] << 16;
  i |= buffer[offset + 1] << 8;
  i |= buffer[offset];
  i += buffer[offset + 3] << 24 >>> 0;
  offset += 4;

  j = buffer[offset + 2] << 16;
  j |= buffer[offset + 1] << 8;
  j |= buffer[offset];
  j += buffer[offset + 3] << 24 >>> 0;
  offset += 4;

  k = buffer[offset + 2] << 16;
  k |= buffer[offset + 1] << 8;
  k |= buffer[offset];
  k += buffer[offset + 3] << 24 >>> 0;
  offset += 4;

  l = (buffer[offset + 2]) << 16;
  l |= buffer[offset + 1] << 8;
  l |= buffer[offset];
  l += buffer[offset + 3] << 24 >>> 0;

  if (k === 0 && l === 0) {
    if (j === 0) {
      return i;
    }
    if (j < INT_2_21 || (j === INT_2_21 && i === 0)) {
      return j * INT_2_32 + i;
    }
  }

  if (i < BASE) {
    x0 = i;
    x1 = 0;
  } else {
    x0 = i % BASE;
    x1 = Math.floor(i / BASE);
  }

  if (j < BASE) {
    x0 += j * INT_2_32_0;
    x1 += j * INT_2_32_1;
    x2 = 0;
  } else {
    z0 = j % BASE;
    z1 = Math.floor(j / BASE);
    x0 += z0 * INT_2_32_0;
    x1 += z0 * INT_2_32_1 + z1 * INT_2_32_0;
    x2 = z1 * INT_2_32_1;
  }

  if (k < BASE) {
    y0 = k;
    y1 = 0;
  } else {
    y0 = k % BASE;
    y1 = Math.floor(k / BASE);
  }

  if (l < BASE) {
    y0 += l * INT_2_32_0;
    y1 += l * INT_2_32_1;
    y2 = 0;
  } else {
    z0 = l % BASE;
    z1 = Math.floor(l / BASE);
    y0 += z0 * INT_2_32_0;
    y1 += z0 * INT_2_32_1 + z1 * INT_2_32_0;
    y2 = z1 * INT_2_32_1;
  }

  if (y0 >= BASE) {
    y1 += Math.floor(y0 / BASE);
    y0 %= BASE;
  }
  if (y1 >= BASE) {
    y2 += Math.floor(y1 / BASE);
    y1 %= BASE;
  }

  x0 += y0 * INT_2_64_0;
  x1 += y0 * INT_2_64_1 + y1 * INT_2_64_0;
  x2 += y0 * INT_2_64_2 + y1 * INT_2_64_1 + y2 * INT_2_64_0;
  x3 = y1 * INT_2_64_2 + y2 * INT_2_64_1;
  x4 = y2 * INT_2_64_2;

  if (x0 >= BASE) {
    x1 += Math.floor(x0 / BASE);
    x0 %= BASE;
  }
  if (x1 >= BASE) {
    x2 += Math.floor(x1 / BASE);
    x1 %= BASE;
  }
  if (x2 >= BASE) {
    x3 += Math.floor(x2 / BASE);
    x2 %= BASE;
  }
  if (x3 >= BASE) {
    x4 += Math.floor(x3 / BASE);
    x3 %= BASE;
  }

  if (x4) {
    return '' + x4 + zeropad.lpad14(x3 * BASE + x2) + zeropad.lpad14(x1 * BASE +
      x0);
  }
  if (x3) {
    return '' + (x3 * BASE + x2) + zeropad.lpad14(x1 * BASE + x0);
  }
  if (x2) {
    if (x2 < INT_2_53_2 || (x2 === INT_2_53_2 &&
      (x1 < INT_2_53_1 || (x1 === INT_2_53_1 && x0 <= INT_2_53_0)))) {
      return (x2 * BASE + x1) * BASE + x0;
    }
    return '' + x2 + zeropad.lpad14(x1 * BASE + x0);

  }
  return x1 * BASE + x0;
}


function writeUInt128(buffer, value, offset) {

  var l, a, b, c, d, e, f,
    x0, x1, x2, x3, y0, y1, z0, z1, z2, z3, z4, z5, z6, z7;

  l = value.length;

  a = +value.substring(l - 7);
  if (l > 7) {
    b = +value.substring(l - 14, l - 7);
  } else {
    b = 0;
  }
  if (l > 14) {
    c = +value.substring(l - 21, l - 14);
  } else {
    c = 0;
  }
  if (l > 21) {
    d = +value.substring(l - 28, l - 21);
  } else {
    d = 0;
  }
  if (l > 28) {
    e = +value.substring(l - 35, l - 28);
  } else {
    e = 0;
  }
  if (l > 35) {
    f = +value.substring(0, l - 35);
  } else {
    f = 0;
  }

  z0 = z1 = z2 = z3 = z4 = z5 = z6 = z7 = 0;

  // set a * 10^0
  if (a) {
    z0 = a % INT_2_16;
    z1 = Math.floor(a / INT_2_16);
  }

  // add b * 10^7
  if (b) {
    y0 = b % INT_2_16;
    y1 = Math.floor(b / INT_2_16);
    z0 += y0 * BIN_10_7_0;
    z1 += y0 * BIN_10_7_1 + y1 * BIN_10_7_0;
    z2 += y1 * BIN_10_7_1;
  }

  // add c * 10^14
  if (c) {
    y0 = c % INT_2_16;
    y1 = Math.floor(c / INT_2_16);
    z0 += y0 * BIN_10_14_0;
    z1 += y0 * BIN_10_14_1 + y1 * BIN_10_14_0;
    z2 += y0 * BIN_10_14_2 + y1 * BIN_10_14_1;
    z3 += y1 * BIN_10_14_2;
  }

  // add d * 10^21
  if (d) {
    y0 = d % INT_2_16;
    y1 = Math.floor(d / INT_2_16);
    z0 += y0 * BIN_10_21_0;
    z1 += y0 * BIN_10_21_1 + y1 * BIN_10_21_0;
    z2 += y0 * BIN_10_21_2 + y1 * BIN_10_21_1;
    z3 += y0 * BIN_10_21_3 + y1 * BIN_10_21_2;
    z4 += y0 * BIN_10_21_4 + y1 * BIN_10_21_3;
    z5 += y1 * BIN_10_21_4;
  }

  // add e * 10^28
  if (e) {
    y0 = e % INT_2_16;
    y1 = Math.floor(e / INT_2_16);
    z0 += y0 * BIN_10_28_0;
    z1 += y0 * BIN_10_28_1 + y1 * BIN_10_28_0;
    z2 += y0 * BIN_10_28_2 + y1 * BIN_10_28_1;
    z3 += y0 * BIN_10_28_3 + y1 * BIN_10_28_2;
    z4 += y0 * BIN_10_28_4 + y1 * BIN_10_28_3;
    z5 += y0 * BIN_10_28_5 + y1 * BIN_10_28_4;
    z6 += y1 * BIN_10_28_5;
  }

  // add f * 10^35
  if (f) {
    y0 = f % INT_2_16;
    z0 += y0 * BIN_10_35_0;
    z1 += y0 * BIN_10_35_1;
    z2 += y0 * BIN_10_35_2;
    z3 += y0 * BIN_10_35_3;
    z4 += y0 * BIN_10_35_4;
    z5 += y0 * BIN_10_35_5;
    z6 += y0 * BIN_10_35_6;
    z7 += y0 * BIN_10_35_7;
  }

  if (z0 >= INT_2_16) {
    z1 += Math.floor(z0 / INT_2_16);
    z0 %= INT_2_16;
  }
  if (z1 >= INT_2_16) {
    z2 += Math.floor(z1 / INT_2_16);
    z1 %= INT_2_16;
  }
  if (z2 >= INT_2_16) {
    z3 += Math.floor(z2 / INT_2_16);
    z2 %= INT_2_16;
  }
  if (z3 >= INT_2_16) {
    z4 += Math.floor(z3 / INT_2_16);
    z3 %= INT_2_16;
  }
  if (z4 >= INT_2_16) {
    z5 += Math.floor(z4 / INT_2_16);
    z4 %= INT_2_16;
  }
  if (z5 >= INT_2_16) {
    z6 += Math.floor(z5 / INT_2_16);
    z5 %= INT_2_16;
  }
  if (z6 >= INT_2_16) {
    z7 += Math.floor(z6 / INT_2_16);
    z6 %= INT_2_16;
  }

  x0 = z1 * INT_2_16 + z0;
  x1 = z3 * INT_2_16 + z2;
  x2 = z5 * INT_2_16 + z4;
  x3 = z7 * INT_2_16 + z6;

  buffer[offset + 3] = (x0 >>> 24) & 0xff;
  buffer[offset + 2] = (x0 >>> 16) & 0xff;
  buffer[offset + 1] = (x0 >>> 8) & 0xff;
  buffer[offset] = x0 & 0xff;
  offset += 4;

  buffer[offset + 3] = (x1 >>> 24) & 0xff;
  buffer[offset + 2] = (x1 >>> 16) & 0xff;
  buffer[offset + 1] = (x1 >>> 8) & 0xff;
  buffer[offset] = x1 & 0xff;
  offset += 4;

  buffer[offset + 3] = (x2 >>> 24) & 0xff;
  buffer[offset + 2] = (x2 >>> 16) & 0xff;
  buffer[offset + 1] = (x2 >>> 8) & 0xff;
  buffer[offset] = x2 & 0xff;
  offset += 4;

  buffer[offset + 3] = (x3 >>> 24) & 0xff;
  buffer[offset + 2] = (x3 >>> 16) & 0xff;
  buffer[offset + 1] = (x3 >>> 8) & 0xff;
  buffer[offset] = x3 & 0xff;
}

function readInt64(buffer, offset) {
  return _readInt64(buffer, offset || 0, false);
}

function readUInt64(buffer, offset) {
  return _readInt64(buffer, offset || 0, true);
}

function writeInt64(buffer, value, offset) {
  _writeInt64(buffer, value, offset || 0, false);
}

function writeUInt64(buffer, value, offset) {
  _writeInt64(buffer, value, offset || 0, true);
}

exports.readInt64LE = readInt64;
exports.readUInt64LE = readUInt64;
exports.writeInt64LE = writeInt64;
exports.writeUInt64LE = writeUInt64;
exports.readUInt128LE = readUInt128;
exports.writeUInt128LE = writeUInt128;
exports.readDec128 = readDec128;
exports.writeDec128 = writeDec128;
exports.readDecFloat = readDecFloat;
exports.readDecFixed = readDecFixed;
},{"./zeropad":243}],241:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';
/* jshint bitwise:false */

var zeropad = require('./zeropad');
var lpad4 = zeropad.lpad4;
var lpad2 = zeropad.lpad2;

var TURN_OF_ERAS = 1721424;
var GREGORIAN = 2299161;

exports.DAYDATE = function DAYDATE(year, month, day) {
  var A, B, C, E, F, Z;

  if (!month) {
    var date = year;
    if (typeof date === 'string') {
      month = +date.substring(5, 7);
      day = +date.substring(8, 10);
      year = +date.substring(0, 4);
    } else if (typeof date === 'object') {
      month = date.getUTCMonth() + 1;
      day = year.getUTCDate();
      year = year.getUTCFullYear();
    }
  } else {
    month += 1;
  }

  if (month < 3) {
    year -= 1;
    month += 12;
  }

  if ((year > 1582) ||
    (year === 1582 && month > 10) ||
    (year === 1582 && month === 10 && day >= 15)) {
    A = ~~ (year / 100);
    B = ~~ (A / 4);
    C = 2 - A + B;
  } else {
    C = 0;
  }
  E = ~~ (365.25 * (year + 4716));
  F = ~~ (30.6001 * (month + 1));
  Z = C + day + E + F - 1524;
  return Z + 1 - TURN_OF_ERAS;
};

exports.DATE = function DATE(daydate) {
  var Z, W, X, A, B, C, D, E, F, year, month, day;

  Z = ~~ (daydate - 1 + TURN_OF_ERAS);
  if (Z >= GREGORIAN) {
    W = ~~ ((Z - 1867216.25) / 36524.25);
    X = ~~ (W / 4);
    A = Z + 1 + W - X;
  } else {
    A = Z;
  }
  B = A + 1524;
  C = ~~ ((B - 122.1) / 365.25);
  D = ~~ (365.25 * C);
  E = ~~ ((B - D) / 30.6001);
  F = ~~ (30.6001 * E);
  day = B - D - F;
  month = E - 1;
  if (month > 12) {
    month -= 12;
  }
  if (month < 3) {
    year = C - 4715;
  } else {
    year = C - 4716;
  }
  return lpad4(year) + '-' + lpad2(month) + '-' + lpad2(day);
};
},{"./zeropad":243}],242:[function(require,module,exports){
(function (process,Buffer){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

/* jshint camelcase:false */

var util = require('util');
var stream = require('stream');
var path = require('path');
var os = require('os');
var fs = require('fs');

if (typeof setImmediate === 'function') {
  exports.setImmediate = setImmediate;
} else {
  exports.setImmediate = process.nextTick;
}

exports.stream = {
  Readable: stream.Readable,
  Writable: stream.Writable,
  Duplex: stream.Duplex,
  Transform: stream.Transform
};

function exportNativeUtil(fn) {
  exports[fn] = util[fn];
}

[
  'format',
  'debug',
  'error',
  'puts',
  'print',
  'log',
  'inspect',
  'isArray',
  'isRegExp',
  'isDate',
  'isError',
  'inherits'
].forEach(exportNativeUtil);

exports.bignum = require('./bignum');
exports.calendar = require('./calendar');
exports.Queue = require('./Queue');
extend(exports, require('./zeropad'));

var debuglog;
if (util.debuglog) {
  debuglog = util.debuglog;
} else {
  try {
    debuglog = require('debuglog');
  } catch (err) {
    /* jshint unused:false */
    debuglog = function dbglg(name) {
      return function () {};
    };
  }
}
exports.debuglog = debuglog;

var traceFunction;
exports.tracelog = function tracelog() {
  if (typeof traceFunction !== 'function') {
    if (process.env.HDB_TRACE) {
      var timestamp = Math.floor(Date.now() / 1000);
      var filename = path.join(os.tmpDir(), 'hdb.trace.' + timestamp +
        '.log');
      console.log('Trace to file', filename);
      traceFunction = function trace(kind, segment) {
        fs.appendFileSync(filename,
          kind + '\n' +
          util.inspect(segment, {
            depth: 9
          }));
      };
    } else {
      traceFunction = function trace() {};
    }
  }
  return traceFunction;
};

function extend(obj) {
  function extendOnce(source) {
    /* jshint forin:false */
    if (source) {
      for (var prop in source) {
        obj[prop] = source[prop];
      }
    }
  }
  Array.prototype.slice.call(arguments, 1).forEach(extendOnce);
  return obj;
}
exports.extend = extend;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function alignLength(length, alignment) {
  if (length % alignment === 0) {
    return length;
  }
  return length + alignment - length % alignment;
}
exports.alignLength = alignLength;

function cc2_(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}
exports.cc2_ = cc2_;

function _2cc(str) {
  return str.toLowerCase().replace(/_([a-z])/g, function toUpperCase(match,
    str) {
    return str.toUpperCase();
  });
}
exports._2cc = _2cc;

function readData(ds, cb) {
  var length = 0;
  var chunks = [];

  function done(err) {
    ds.removeListener('error', onerror);
    ds.removeListener('data', ondata);
    ds.removeListener('end', onend);
    if (isFunction(cb)) {
      if (err) {
        return cb(err);
      }
      cb(null, Buffer.concat(chunks, length));
    }
  }

  function onerror(err) {
    done(err);
  }
  ds.on('error', onerror);

  function ondata(chunk) {
    chunks.push(chunk);
    length += chunk.length;
  }
  ds.on('data', ondata);

  function onend() {
    done(null);
  }
  ds.on('end', onend);
  ds.resume();
}
exports.readData = readData;

function proxyEvents(source, target, events) {

  function proxyEvent(ev) {
    source.on(ev, target.emit.bind(target, ev));
  }
  events.forEach(proxyEvent);
  return target;
}
exports.proxyEvents = proxyEvents;

function createReadStream(ds, events, options) {
  if (!util.isArray(events)) {
    options = events;
    events = ['error', 'close'];
  }

  var readable = new stream.Readable(options);
  readable._read = function _read() {
    ds.resume();
  };

  function onend() {
    readable.push(null);
  }
  ds.once('end', onend);

  function ondata(chunk) {
    if (!chunk || !chunk.length || readable._readableState.ended) {
      return;
    }
    if (!readable.push(chunk)) {
      ds.pause();
    }
  }
  ds.on('data', ondata);

  proxyEvents(ds, readable, events);
  return readable;
}
exports.createReadStream = createReadStream;

function pipe(source, target, events) {
  proxyEvents(source, target, events || ['error']);
  return source.pipe(target);
}
exports.pipe = pipe;
}).call(this,require('_process'),require("buffer").Buffer)
},{"./Queue":239,"./bignum":240,"./calendar":241,"./zeropad":243,"_process":147,"buffer":"buffer","debuglog":248,"fs":1,"os":145,"path":146,"stream":159,"util":162}],243:[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';
/* jshint curly: false */

var INT_10_1 = Math.pow(10, 1);
var INT_10_2 = Math.pow(10, 2);
var INT_10_3 = Math.pow(10, 3);
var INT_10_4 = Math.pow(10, 4);
var INT_10_5 = Math.pow(10, 5);
var INT_10_6 = Math.pow(10, 6);
var INT_10_7 = Math.pow(10, 7);
var INT_10_8 = Math.pow(10, 8);
var INT_10_9 = Math.pow(10, 9);
var INT_10_10 = Math.pow(10, 10);
var INT_10_11 = Math.pow(10, 11);
var INT_10_12 = Math.pow(10, 12);
var INT_10_13 = Math.pow(10, 13);

var ZERO_0 = '';
var ZERO_1 = '0';
var ZERO_2 = '00';
var ZERO_3 = '000';
var ZERO_4 = '0000';
var ZERO_5 = '00000';
var ZERO_6 = '000000';
var ZERO_7 = '0000000';
var ZERO_8 = '00000000';
var ZERO_9 = '000000000';
var ZERO_10 = '0000000000';
var ZERO_11 = '00000000000';
var ZERO_12 = '000000000000';
var ZERO_13 = '0000000000000';

/* Decimal zero padding */
var MAX_DECIMAL_LENGTH = 35;
var ZEROS = exports.ZEROS = [''];
for (var i = 1; i < MAX_DECIMAL_LENGTH; i++) {
  ZEROS.push(ZEROS[i - 1] + '0');
}

exports.lpad = function lpad(length, n) {
  var z = '' + n;
  while (z.length < length) {
    z = ZEROS[Math.min(length - z.length, MAX_DECIMAL_LENGTH - 1)] + z;
  }
  return z;
};

exports.lpad14 = function lpad14(n) {
  if (n >= INT_10_13) return ZERO_0 + n;
  if (n >= INT_10_12) return ZERO_1 + n;
  if (n >= INT_10_11) return ZERO_2 + n;
  if (n >= INT_10_10) return ZERO_3 + n;
  if (n >= INT_10_9) return ZERO_4 + n;
  if (n >= INT_10_8) return ZERO_5 + n;
  if (n >= INT_10_7) return ZERO_6 + n;
  if (n >= INT_10_6) return ZERO_7 + n;
  if (n >= INT_10_5) return ZERO_8 + n;
  if (n >= INT_10_4) return ZERO_9 + n;
  if (n >= INT_10_3) return ZERO_10 + n;
  if (n >= INT_10_2) return ZERO_11 + n;
  if (n >= INT_10_1) return ZERO_12 + n;
  return ZERO_13 + n;
};

exports.lpad7 = function lpad7(n) {
  if (n >= INT_10_6) return ZERO_0 + n;
  if (n >= INT_10_5) return ZERO_1 + n;
  if (n >= INT_10_4) return ZERO_2 + n;
  if (n >= INT_10_3) return ZERO_3 + n;
  if (n >= INT_10_2) return ZERO_4 + n;
  if (n >= INT_10_1) return ZERO_5 + n;
  return ZERO_6 + n;
};

exports.lpad4 = function lpad4(n) {
  if (n >= INT_10_3) return ZERO_0 + n;
  if (n >= INT_10_2) return ZERO_1 + n;
  if (n >= INT_10_1) return ZERO_2 + n;
  return ZERO_3 + n;
};

exports.lpad2 = function lpad2(n) {
  if (n >= INT_10_1) return ZERO_0 + n;
  return ZERO_1 + n;
};
},{}],244:[function(require,module,exports){
(function (process,Buffer){
/**
 * net
 * ===
 *
 * The net module provides you with an asynchronous network wrapper. It
 * contains methods for creating both servers and clients (called streams).
 * You can include this module with require('chrome-net')
 */

var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')
var ipaddr = require('ipaddr.js')
var is = require('core-util-is')
var stream = require('stream')

// Track open servers and sockets to route incoming sockets (via onAccept and onReceive)
// to the right handlers.
var servers = {}
var sockets = {}

if (typeof chrome !== 'undefined') {
  chrome.sockets.tcpServer.onAccept.addListener(onAccept)
  chrome.sockets.tcpServer.onAcceptError.addListener(onAcceptError)
  chrome.sockets.tcp.onReceive.addListener(onReceive)
  chrome.sockets.tcp.onReceiveError.addListener(onReceiveError)
}

function onAccept (info) {
  if (info.socketId in servers) {
    servers[info.socketId]._onAccept(info.clientSocketId)
  } else {
    console.error('Unknown server socket id: ' + info.socketId)
  }
}

function onAcceptError (info) {
  if (info.socketId in servers) {
    servers[info.socketId]._onAcceptError(info.resultCode)
  } else {
    console.error('Unknown server socket id: ' + info.socketId)
  }
}

function onReceive (info) {
  if (info.socketId in sockets) {
    sockets[info.socketId]._onReceive(info.data)
  } else {
    console.error('Unknown socket id: ' + info.socketId)
  }
}

function onReceiveError (info) {
  if (info.socketId in sockets) {
    sockets[info.socketId]._onReceiveError(info.resultCode)
  } else {
    if (info.resultCode === -100) // net::ERR_CONNECTION_CLOSED
      return
    console.error('Unknown socket id: ' + info.socketId)
  }
}

/**
 * Creates a new TCP server. The connectionListener argument is automatically
 * set as a listener for the 'connection' event.
 *
 * @param  {Object} options
 * @param  {function} listener
 * @return {Server}
 */
exports.createServer = function (options, listener) {
  return new Server(options, listener)
}

/**
 * net.connect(options, [connectionListener])
 * net.createConnection(options, [connectionListener])
 *
 * Constructs a new socket object and opens the socket to the given location.
 * When the socket is established, the 'connect' event will be emitted.
 *
 * For TCP sockets, options argument should be an object which specifies:
 *
 *   port: Port the client should connect to (Required).
 *   host: Host the client should connect to. Defaults to 'localhost'.
 *   localAddress: Local interface to bind to for network connections.
 *
 * ===============================================================
 *
 * net.connect(port, [host], [connectListener])
 * net.createConnection(port, [host], [connectListener])
 *
 * Creates a TCP connection to port on host. If host is omitted,
 * 'localhost' will be assumed. The connectListener parameter will be
 * added as an listener for the 'connect' event.
 *
 * @param {Object} options
 * @param {function} listener
 * @return {Socket}
 */
exports.connect = exports.createConnection = function () {
  var args = normalizeConnectArgs(arguments)
  var s = new Socket(args[0])
  return Socket.prototype.connect.apply(s, args)
}

inherits(Server, EventEmitter)

/**
 * Class: net.Server
 * =================
 *
 * This class is used to create a TCP server.
 *
 * Event: 'listening'
 *   Emitted when the server has been bound after calling server.listen.
 *
 * Event: 'connection'
 *   - Socket object The connection object
 *   Emitted when a new connection is made. socket is an instance of net.Socket.
 *
 * Event: 'close'
 *   Emitted when the server closes. Note that if connections exist, this event
 *   is not emitted until all connections are ended.
 *
 * Event: 'error'
 *   - Error Object
 *   Emitted when an error occurs. The 'close' event will be called directly
 *   following this event. See example in discussion of server.listen.
 */
function Server (/* [options], listener */) {
  var self = this
  if (!(self instanceof Server)) return new Server(arguments[0], arguments[1])
  EventEmitter.call(self)

  var options

  if (is.isFunction(arguments[0])) {
    options = {}
    self.on('connection', arguments[0])
  } else {
    options = arguments[0] || {}

    if (is.isFunction(arguments[1])) {
      self.on('connection', arguments[1])
    }
  }

  self._destroyed = false
  self._connections = 0
}
exports.Server = Server

/**
 * server.listen(port, [host], [backlog], [callback])
 *
 * Begin accepting connections on the specified port and host. If the host is
 * omitted, the server will accept connections directed to any IPv4 address
 * (INADDR_ANY). A port value of zero will assign a random port.
 *
 * Backlog is the maximum length of the queue of pending connections. The
 * actual length will be determined by your OS through sysctl settings such as
 * tcp_max_syn_backlog and somaxconn on linux. The default value of this
 * parameter is 511 (not 512).
 *
 * This function is asynchronous. When the server has been bound, 'listening'
 * event will be emitted. The last parameter callback will be added as an
 * listener for the 'listening' event.
 *
 * @return {Socket}
 */
Server.prototype.listen = function (/* variable arguments... */) {
  var self = this

  var lastArg = arguments[arguments.length - 1]
  if (is.isFunction(lastArg)) {
    self.once('listening', lastArg)
  }

  // If port is invalid or undefined, bind to a random port.
  var port = toNumber(arguments[0]) || 0

  var address
  if (arguments[1] == null ||
      is.isFunction(arguments[1]) ||
      is.isNumber(arguments[1])) {
    // The first argument is the port, no IP given.
    address = '0.0.0.0'
  } else {
    address = arguments[1]
  }

  // The third optional argument is the backlog size.
  // When the ip is omitted it can be the second argument.
  var backlog = toNumber(arguments[1]) || toNumber(arguments[2]) || undefined

  chrome.sockets.tcpServer.create(function (createInfo) {
    self.id = createInfo.socketId

    chrome.sockets.tcpServer.listen(self.id, address, port, backlog, function (result) {
      if (result < 0) {
        self.emit('error', new Error('Socket ' + self.id + ' failed to listen. ' +
          chrome.runtime.lastError.message))
        self._destroy()
        return
      }

      servers[self.id] = self

      chrome.sockets.tcpServer.getInfo(self.id, function (socketInfo) {
        self._address = socketInfo.localAddress
        self._port = socketInfo.localPort
        self.emit('listening')
      })

    })
  })

  return self
}

Server.prototype._onAccept = function (clientSocketId) {
  var self = this

  // Set the `maxConnections` property to reject connections when the server's
  // connection count gets high.
  if (self.maxConnections && self._connections >= self.maxConnections) {
    chrome.sockets.tcpServer.disconnect(clientSocketId)
    chrome.sockets.tcpServer.close(clientSocketId)
    console.warn('Rejected connection - hit `maxConnections` limit')
    return
  }

  self._connections += 1

  var acceptedSocket = new Socket({
    server: self,
    id: clientSocketId
  })
  acceptedSocket.on('connect', function () {
    self.emit('connection', acceptedSocket)
  })

  chrome.sockets.tcp.setPaused(clientSocketId, false)
}

Server.prototype._onAcceptError = function (resultCode) {
  var self = this
  self.emit('error', new Error('Socket ' + self.id + ' failed to accept (' +
    resultCode + ')'))
  self._destroy()
}

/**
 * Stops the server from accepting new connections and keeps existing
 * connections. This function is asynchronous, the server is finally closed
 * when all connections are ended and the server emits a 'close' event.
 * Optionally, you can pass a callback to listen for the 'close' event.
 * @param  {function} callback
 */
Server.prototype.close = function (callback) {
  var self = this
  self._destroy(callback)
}

Server.prototype._destroy = function (exception, cb) {
  var self = this

  if (self._destroyed)
    return

  if (cb)
    this.once('close', cb)

  this._destroyed = true
  this._connections = 0
  delete servers[self.id]

  chrome.sockets.tcpServer.disconnect(self.id, function () {
    chrome.sockets.tcpServer.close(self.id, function () {
      self.emit('close')
    })
  })
}

/**
 * Returns the bound address, the address family name and port of the socket
 * as reported by the operating system. Returns an object with three
 * properties, e.g. { port: 12346, family: 'IPv4', address: '127.0.0.1' }
 *
 * @return {Object} information
 */
Server.prototype.address = function () {
  var self = this
  return {
    address: self._address,
    port: self._port,
    family: 'IPv4'
  }
}

Server.prototype.unref = function () {
  // No chrome.socket equivalent
}

Server.prototype.ref = function () {
  // No chrome.socket equivalent
}

/**
 * Asynchronously get the number of concurrent connections on the server.
 * Works when sockets were sent to forks.
 *
 * Callback should take two arguments err and count.
 *
 * @param  {function} callback
 */
Server.prototype.getConnections = function (callback) {
  var self = this
  process.nextTick(function () {
    callback(null, self._connections)
  })
}


inherits(Socket, stream.Duplex)

/**
 * Class: net.Socket
 * =================
 *
 * This object is an abstraction of a TCP or UNIX socket. net.Socket instances
 * implement a duplex Stream interface. They can be created by the user and
 * used as a client (with connect()) or they can be created by Node and passed
 * to the user through the 'connection' event of a server.
 *
 * Construct a new socket object.
 *
 * options is an object with the following defaults:
 *
 *   { fd: null // NO CHROME EQUIVALENT
 *     type: null
 *     allowHalfOpen: false // NO CHROME EQUIVALENT
 *   }
 *
 * `type` can only be 'tcp4' (for now).
 *
 * Event: 'connect'
 *   Emitted when a socket connection is successfully established. See
 *   connect().
 *
 * Event: 'data'
 *   - Buffer object
 *   Emitted when data is received. The argument data will be a Buffer or
 *   String. Encoding of data is set by socket.setEncoding(). (See the Readable
 *   Stream section for more information.)
 *
 *   Note that the data will be lost if there is no listener when a Socket
 *   emits a 'data' event.
 *
 * Event: 'end'
 *   Emitted when the other end of the socket sends a FIN packet.
 *
 *   By default (allowHalfOpen == false) the socket will destroy its file
 *   descriptor once it has written out its pending write queue. However,
 *   by setting allowHalfOpen == true the socket will not automatically
 *   end() its side allowing the user to write arbitrary amounts of data,
 *   with the caveat that the user is required to end() their side now.
 *
 * Event: 'timeout'
 *   Emitted if the socket times out from inactivity. This is only to notify
 *   that the socket has been idle. The user must manually close the connection.
 *
 *   See also: socket.setTimeout()
 *
 * Event: 'drain'
 *   Emitted when the write buffer becomes empty. Can be used to throttle
 *   uploads.
 *
 *   See also: the return values of socket.write()
 *
 * Event: 'error'
 *   - Error object
 *   Emitted when an error occurs. The 'close' event will be called directly
 *   following this event.
 *
 * Event: 'close'
 *   - had_error Boolean true if the socket had a transmission error
 *   Emitted once the socket is fully closed. The argument had_error is a
 *   boolean which says if the socket was closed due to a transmission error.
 */
function Socket (options) {
  var self = this
  if (!(self instanceof Socket)) return new Socket(options)

  if (is.isUndefined(options))
    options = {}

  stream.Duplex.call(self, options)

  self.destroyed = false
  self.errorEmitted = false
  self.readable = self.writable = false

  // The amount of received bytes.
  self.bytesRead = 0

  self._bytesDispatched = 0
  self._connecting = false

  self.ondata = null
  self.onend = null

  if (options.server) {
    self.server = options.server
    self.id = options.id

    // For incoming sockets (from server), it's already connected.
    self._connecting = true
    self._onConnect()
  }
}
exports.Socket = Socket

/**
 * socket.connect(port, [host], [connectListener])
 * socket.connect(options, [connectListener])
 *
 * Opens the connection for a given socket. If port and host are given, then
 * the socket will be opened as a TCP socket, if host is omitted, localhost
 * will be assumed. If a path is given, the socket will be opened as a unix
 * socket to that path.
 *
 * Normally this method is not needed, as net.createConnection opens the
 * socket. Use this only if you are implementing a custom Socket.
 *
 * This function is asynchronous. When the 'connect' event is emitted the
 * socket is established. If there is a problem connecting, the 'connect'
 * event will not be emitted, the 'error' event will be emitted with the
 * exception.
 *
 * The connectListener parameter will be added as an listener for the
 * 'connect' event.
 *
 * @param  {Object} options
 * @param  {function} cb
 * @return {Socket}   this socket (for chaining)
 */
Socket.prototype.connect = function (options, cb) {
  var self = this

  if (self._connecting)
    return
  self._connecting = true

  var port = Number(options.port)

  if (is.isFunction(cb)) {
    self.once('connect', cb)
  }

  chrome.sockets.tcp.create(function (createInfo) {
    if (self.destroyed) {
      chrome.sockets.tcp.close(createInfo.socketId)
      return
    }

    self.id = createInfo.socketId

    chrome.sockets.tcp.connect(self.id, options.host, port, function (result) {
      if (result < 0) {
        self.destroy(new Error('Socket ' + self.id + ' connect error ' + result
          + ': ' + chrome.runtime.lastError.message))
        return
      }

      self._onConnect()
    })
  })

  return self
}

Socket.prototype._onConnect = function () {
  var self = this

  sockets[self.id] = self
  chrome.sockets.tcp.getInfo(self.id, function (result) {
    self.remoteAddress = result.peerAddress
    self.remotePort = result.peerPort
    self.localAddress = result.localAddress
    self.localPort = result.localPort

    self._connecting = false
    self.readable = self.writable = true

    self.emit('connect')
    // start the first read, or get an immediate EOF.
    // this doesn't actually consume any bytes, because len=0
    self.read(0)
  })
}

/**
 * The number of characters currently buffered to be written.
 * @type {number}
 */
Object.defineProperty(Socket.prototype, 'bufferSize', {
  get: function () {
    var self = this
    if (self._pendingData)
      return self._pendingData.length
    else
      return 0 // Unfortunately, chrome.socket does not make this info available
  }
})

/**
 * Sends data on the socket. The second parameter specifies the encoding in
 * the case of a string--it defaults to UTF8 encoding.
 *
 * Returns true if the entire data was flushed successfully to the kernel
 * buffer. Returns false if all or part of the data was queued in user memory.
 * 'drain' will be emitted when the buffer is again free.
 *
 * The optional callback parameter will be executed when the data is finally
 * written out - this may not be immediately.
 *
 * @param  {Buffer|Arrayish|string} chunk
 * @param  {string} [encoding]
 * @param  {function} [callback]
 * @return {boolean}             flushed to kernel completely?
 */
Socket.prototype.write = function (chunk, encoding, callback) {
  var self = this
  if (!Buffer.isBuffer(chunk))
    chunk = new Buffer(chunk, encoding)

  return stream.Duplex.prototype.write.call(self, chunk, encoding, callback)
}

Socket.prototype._write = function (buffer, encoding, callback) {
  var self = this
  if (!callback) callback = function () {}

  if (!self.writable) {
    self._pendingData = buffer
    self._pendingEncoding = encoding
    self.once('connect', function () {
      self._write(buffer, encoding, callback)
    })
    return
  }
  self._pendingData = null
  self._pendingEncoding = null

  // assuming buffer is browser implementation (`buffer` package on npm)
  var buf = buffer.buffer
  if (buffer.byteOffset || buffer.byteLength !== buf.byteLength)
    buf = buf.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

  chrome.sockets.tcp.send(self.id, buf, function (sendInfo) {
    if (sendInfo.resultCode < 0) {
      var err = new Error('Socket ' + self.id + ' write error: ' + sendInfo.resultCode)
      callback(err)
      self.destroy(err)
    } else {
      self._resetTimeout()
      callback(null)
    }
  })

  self._bytesDispatched += buffer.length
}

Socket.prototype._read = function (bufferSize) {
  var self = this
  if (self._connecting) {
    self.once('connect', self._read.bind(self, bufferSize))
    return
  }

  chrome.sockets.tcp.setPaused(self.id, false)
}

Socket.prototype._onReceive = function (data) {
  var self = this
  var buffer = new Buffer(new Uint8Array(data))
  var offset = self.bytesRead

  self.bytesRead += buffer.length
  self._resetTimeout()

  if (self.ondata) self.ondata(buffer, offset, self.bytesRead)
  if (!self.push(buffer)) { // if returns false, then apply backpressure
    chrome.sockets.tcp.setPaused(self.id, true)
  }
}

Socket.prototype._onReceiveError = function (resultCode) {
  var self = this
  if (resultCode === -100) {
    if (self.onend) self.once('end', self.onend)
    self.push(null)
    self.destroy()
  } else if (resultCode < 0) {
    self.destroy(new Error('Socket ' + self.id + ' receive error ' + resultCode))
  }
}

/**
 * The amount of bytes sent.
 * @return {number}
 */
Object.defineProperty(Socket.prototype, 'bytesWritten', {
  get: function () {
    var self = this
    var bytes = self._bytesDispatched

    self._writableState.toArrayBuffer().forEach(function (el) {
      if (Buffer.isBuffer(el.chunk))
        bytes += el.chunk.length
      else
        bytes += new Buffer(el.chunk, el.encoding).length
    })

    if (self._pendingData) {
      if (Buffer.isBuffer(self._pendingData))
        bytes += self._pendingData.length
      else
        bytes += Buffer.byteLength(self._pendingData, self._pendingEncoding)
    }

    return bytes
  }
})

Socket.prototype.destroy = function (exception) {
  var self = this
  self._destroy(exception)
}

Socket.prototype._destroy = function (exception, cb) {
  var self = this

  function fireErrorCallbacks () {
    if (cb) cb(exception)
    if (exception && !self.errorEmitted) {
      process.nextTick(function () {
        self.emit('error', exception)
      })
      self.errorEmitted = true
    }
  }

  if (self.destroyed) {
    // already destroyed, fire error callbacks
    fireErrorCallbacks()
    return
  }

  if (this.server) {
    this.server._connections -= 1
  }

  self._connecting = false
  this.readable = this.writable = false
  self.destroyed = true
  delete sockets[self.id]

  // if _destroy() has been called before chrome.sockets.tcp.create()
  // callback, we don't have an id. Therefore we don't need to close
  // or disconnect
  if (self.id) {
    chrome.sockets.tcp.disconnect(self.id, function () {
      chrome.sockets.tcp.close(self.id, function () {
        self.emit('close', !!exception)
        fireErrorCallbacks()
      })
    })
  }
}

Socket.prototype.destroySoon = function () {
  var self = this

  if (self.writable)
    self.end()

  if (self._writableState.finished)
    self.destroy()
  else
    self.once('finish', self._destroy.bind(self))
}

/**
 * Sets the socket to timeout after timeout milliseconds of inactivity on the socket.
 * By default net.Socket do not have a timeout. When an idle timeout is triggered the
 * socket will receive a 'timeout' event but the connection will not be severed. The
 * user must manually end() or destroy() the socket.
 *
 * If timeout is 0, then the existing idle timeout is disabled.
 *
 * The optional callback parameter will be added as a one time listener for the 'timeout' event.
 *
 * @param {number}   timeout
 * @param {function} callback
 */
Socket.prototype.setTimeout = function (timeout, callback) {
  var self = this
  if (callback) self.once('timeout', callback)
  self._timeoutMs = timeout
  self._resetTimeout()
}

Socket.prototype._onTimeout = function () {
  var self = this
  self._timeout = null
  self._timeoutMs = 0
  self.emit('timeout')
}

Socket.prototype._resetTimeout = function () {
  var self = this
  if (self._timeout) {
    clearTimeout(self._timeout)
  }
  if (self._timeoutMs) {
    self._timeout = setTimeout(self._onTimeout.bind(self), self._timeoutMs)
  }
}

/**
 * Disables the Nagle algorithm. By default TCP connections use the Nagle
 * algorithm, they buffer data before sending it off. Setting true for noDelay
 * will immediately fire off data each time socket.write() is called. noDelay
 * defaults to true.
 *
 * NOTE: The Chrome version of this function is async, whereas the node
 * version is sync. Keep this in mind.
 *
 * @param {boolean} [noDelay] Optional
 * @param {function} callback CHROME-SPECIFIC: Called when the configuration
 *                            operation is done.
 */
Socket.prototype.setNoDelay = function (noDelay, callback) {
  var self = this
  // backwards compatibility: assume true when `enable` is omitted
  noDelay = is.isUndefined(noDelay) ? true : !!noDelay
  if (!callback) callback = function () {}
  chrome.sockets.tcp.setNoDelay(self.id, noDelay, callback)
}

/**
 * Enable/disable keep-alive functionality, and optionally set the initial
 * delay before the first keepalive probe is sent on an idle socket. enable
 * defaults to false.
 *
 * Set initialDelay (in milliseconds) to set the delay between the last data
 * packet received and the first keepalive probe. Setting 0 for initialDelay
 * will leave the value unchanged from the default (or previous) setting.
 * Defaults to 0.
 *
 * NOTE: The Chrome version of this function is async, whereas the node
 * version is sync. Keep this in mind.
 *
 * @param {boolean} [enable] Optional
 * @param {number} [initialDelay]
 * @param {function} callback CHROME-SPECIFIC: Called when the configuration
 *                            operation is done.
 */
Socket.prototype.setKeepAlive = function (enable, initialDelay, callback) {
  var self = this
  if (!callback) callback = function () {}
  chrome.sockets.tcp.setKeepAlive(self.id, !!enable, ~~(initialDelay / 1000),
      callback)
}

/**
 * Returns the bound address, the address family name and port of the socket
 * as reported by the operating system. Returns an object with three
 * properties, e.g. { port: 12346, family: 'IPv4', address: '127.0.0.1' }
 *
 * @return {Object} information
 */
Socket.prototype.address = function () {
  var self = this
  return {
    address: self.localAddress,
    port: self.localPort,
    family: 'IPv4'
  }
}

Object.defineProperty(Socket.prototype, 'readyState', {
  get: function () {
    var self = this
    if (self._connecting) {
      return 'opening'
    } else if (self.readable && self.writable) {
      return 'open'
    } else {
      return 'closed'
    }
  }
})

Socket.prototype.unref = function () {
  // No chrome.socket equivalent
}

Socket.prototype.ref = function () {
  // No chrome.socket equivalent
}

//
// EXPORTED HELPERS
//

exports.isIP = function (input) {
  try {
    ipaddr.parse(input)
  } catch (e) {
    return false
  }
  return true
}

exports.isIPv4 = function (input) {
  try {
    var parsed = ipaddr.parse(input)
    return (parsed.kind() === 'ipv4')
  } catch (e) {
    return false
  }
}

exports.isIPv6 = function (input) {
  try {
    var parsed = ipaddr.parse(input)
    return (parsed.kind() === 'ipv6')
  } catch (e) {
    return false
  }
}

//
// HELPERS
//

/**
 * Returns an array [options] or [options, cb]
 * It is the same as the argument of Socket.prototype.connect().
 */
function normalizeConnectArgs (args) {
  var options = {}

  if (is.isObject(args[0])) {
    // connect(options, [cb])
    options = args[0]
  } else {
    // connect(port, [host], [cb])
    options.port = args[0]
    if (is.isString(args[1])) {
      options.host = args[1]
    } else {
      options.host = '127.0.0.1'
    }
  }

  var cb = args[args.length - 1]
  return is.isFunction(cb) ? [options, cb] : [options]
}

function toNumber (x) {
  return (x = Number(x)) >= 0 ? x : false
}

}).call(this,require('_process'),require("buffer").Buffer)
},{"_process":147,"buffer":"buffer","core-util-is":245,"events":142,"inherits":246,"ipaddr.js":247,"stream":159}],245:[function(require,module,exports){
arguments[4][154][0].apply(exports,arguments)
},{"buffer":"buffer","dup":154}],246:[function(require,module,exports){
arguments[4][143][0].apply(exports,arguments)
},{"dup":143}],247:[function(require,module,exports){
(function() {
  var expandIPv6, ipaddr, ipv4Part, ipv4Regexes, ipv6Part, ipv6Regexes, matchCIDR, root;

  ipaddr = {};

  root = this;

  if ((typeof module !== "undefined" && module !== null) && module.exports) {
    module.exports = ipaddr;
  } else {
    root['ipaddr'] = ipaddr;
  }

  matchCIDR = function(first, second, partSize, cidrBits) {
    var part, shift;
    if (first.length !== second.length) {
      throw new Error("ipaddr: cannot match CIDR for objects with different lengths");
    }
    part = 0;
    while (cidrBits > 0) {
      shift = partSize - cidrBits;
      if (shift < 0) {
        shift = 0;
      }
      if (first[part] >> shift !== second[part] >> shift) {
        return false;
      }
      cidrBits -= partSize;
      part += 1;
    }
    return true;
  };

  ipaddr.subnetMatch = function(address, rangeList, defaultName) {
    var rangeName, rangeSubnets, subnet, _i, _len;
    if (defaultName == null) {
      defaultName = 'unicast';
    }
    for (rangeName in rangeList) {
      rangeSubnets = rangeList[rangeName];
      if (toString.call(rangeSubnets[0]) !== '[object Array]') {
        rangeSubnets = [rangeSubnets];
      }
      for (_i = 0, _len = rangeSubnets.length; _i < _len; _i++) {
        subnet = rangeSubnets[_i];
        if (address.match.apply(address, subnet)) {
          return rangeName;
        }
      }
    }
    return defaultName;
  };

  ipaddr.IPv4 = (function() {
    function IPv4(octets) {
      var octet, _i, _len;
      if (octets.length !== 4) {
        throw new Error("ipaddr: ipv4 octet count should be 4");
      }
      for (_i = 0, _len = octets.length; _i < _len; _i++) {
        octet = octets[_i];
        if (!((0 <= octet && octet <= 255))) {
          throw new Error("ipaddr: ipv4 octet is a byte");
        }
      }
      this.octets = octets;
    }

    IPv4.prototype.kind = function() {
      return 'ipv4';
    };

    IPv4.prototype.toString = function() {
      return this.octets.join(".");
    };

    IPv4.prototype.toByteArray = function() {
      return this.octets.slice(0);
    };

    IPv4.prototype.match = function(other, cidrRange) {
      if (other.kind() !== 'ipv4') {
        throw new Error("ipaddr: cannot match ipv4 address with non-ipv4 one");
      }
      return matchCIDR(this.octets, other.octets, 8, cidrRange);
    };

    IPv4.prototype.SpecialRanges = {
      unspecified: [[new IPv4([0, 0, 0, 0]), 8]],
      broadcast: [[new IPv4([255, 255, 255, 255]), 32]],
      multicast: [[new IPv4([224, 0, 0, 0]), 4]],
      linkLocal: [[new IPv4([169, 254, 0, 0]), 16]],
      loopback: [[new IPv4([127, 0, 0, 0]), 8]],
      "private": [[new IPv4([10, 0, 0, 0]), 8], [new IPv4([172, 16, 0, 0]), 12], [new IPv4([192, 168, 0, 0]), 16]],
      reserved: [[new IPv4([192, 0, 0, 0]), 24], [new IPv4([192, 0, 2, 0]), 24], [new IPv4([192, 88, 99, 0]), 24], [new IPv4([198, 51, 100, 0]), 24], [new IPv4([203, 0, 113, 0]), 24], [new IPv4([240, 0, 0, 0]), 4]]
    };

    IPv4.prototype.range = function() {
      return ipaddr.subnetMatch(this, this.SpecialRanges);
    };

    IPv4.prototype.toIPv4MappedAddress = function() {
      return ipaddr.IPv6.parse("::ffff:" + (this.toString()));
    };

    return IPv4;

  })();

  ipv4Part = "(0?\\d+|0x[a-f0-9]+)";

  ipv4Regexes = {
    fourOctet: new RegExp("^" + ipv4Part + "\\." + ipv4Part + "\\." + ipv4Part + "\\." + ipv4Part + "$", 'i'),
    longValue: new RegExp("^" + ipv4Part + "$", 'i')
  };

  ipaddr.IPv4.parser = function(string) {
    var match, parseIntAuto, part, shift, value;
    parseIntAuto = function(string) {
      if (string[0] === "0" && string[1] !== "x") {
        return parseInt(string, 8);
      } else {
        return parseInt(string);
      }
    };
    if (match = string.match(ipv4Regexes.fourOctet)) {
      return (function() {
        var _i, _len, _ref, _results;
        _ref = match.slice(1, 6);
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          part = _ref[_i];
          _results.push(parseIntAuto(part));
        }
        return _results;
      })();
    } else if (match = string.match(ipv4Regexes.longValue)) {
      value = parseIntAuto(match[1]);
      if (value > 0xffffffff || value < 0) {
        throw new Error("ipaddr: address outside defined range");
      }
      return ((function() {
        var _i, _results;
        _results = [];
        for (shift = _i = 0; _i <= 24; shift = _i += 8) {
          _results.push((value >> shift) & 0xff);
        }
        return _results;
      })()).reverse();
    } else {
      return null;
    }
  };

  ipaddr.IPv6 = (function() {
    function IPv6(parts) {
      var part, _i, _len;
      if (parts.length !== 8) {
        throw new Error("ipaddr: ipv6 part count should be 8");
      }
      for (_i = 0, _len = parts.length; _i < _len; _i++) {
        part = parts[_i];
        if (!((0 <= part && part <= 0xffff))) {
          throw new Error("ipaddr: ipv6 part should fit to two octets");
        }
      }
      this.parts = parts;
    }

    IPv6.prototype.kind = function() {
      return 'ipv6';
    };

    IPv6.prototype.toString = function() {
      var compactStringParts, part, pushPart, state, stringParts, _i, _len;
      stringParts = (function() {
        var _i, _len, _ref, _results;
        _ref = this.parts;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          part = _ref[_i];
          _results.push(part.toString(16));
        }
        return _results;
      }).call(this);
      compactStringParts = [];
      pushPart = function(part) {
        return compactStringParts.push(part);
      };
      state = 0;
      for (_i = 0, _len = stringParts.length; _i < _len; _i++) {
        part = stringParts[_i];
        switch (state) {
          case 0:
            if (part === '0') {
              pushPart('');
            } else {
              pushPart(part);
            }
            state = 1;
            break;
          case 1:
            if (part === '0') {
              state = 2;
            } else {
              pushPart(part);
            }
            break;
          case 2:
            if (part !== '0') {
              pushPart('');
              pushPart(part);
              state = 3;
            }
            break;
          case 3:
            pushPart(part);
        }
      }
      if (state === 2) {
        pushPart('');
        pushPart('');
      }
      return compactStringParts.join(":");
    };

    IPv6.prototype.toByteArray = function() {
      var bytes, part, _i, _len, _ref;
      bytes = [];
      _ref = this.parts;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        part = _ref[_i];
        bytes.push(part >> 8);
        bytes.push(part & 0xff);
      }
      return bytes;
    };

    IPv6.prototype.toNormalizedString = function() {
      var part;
      return ((function() {
        var _i, _len, _ref, _results;
        _ref = this.parts;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          part = _ref[_i];
          _results.push(part.toString(16));
        }
        return _results;
      }).call(this)).join(":");
    };

    IPv6.prototype.match = function(other, cidrRange) {
      if (other.kind() !== 'ipv6') {
        throw new Error("ipaddr: cannot match ipv6 address with non-ipv6 one");
      }
      return matchCIDR(this.parts, other.parts, 16, cidrRange);
    };

    IPv6.prototype.SpecialRanges = {
      unspecified: [new IPv6([0, 0, 0, 0, 0, 0, 0, 0]), 128],
      linkLocal: [new IPv6([0xfe80, 0, 0, 0, 0, 0, 0, 0]), 10],
      multicast: [new IPv6([0xff00, 0, 0, 0, 0, 0, 0, 0]), 8],
      loopback: [new IPv6([0, 0, 0, 0, 0, 0, 0, 1]), 128],
      uniqueLocal: [new IPv6([0xfc00, 0, 0, 0, 0, 0, 0, 0]), 7],
      ipv4Mapped: [new IPv6([0, 0, 0, 0, 0, 0xffff, 0, 0]), 96],
      rfc6145: [new IPv6([0, 0, 0, 0, 0xffff, 0, 0, 0]), 96],
      rfc6052: [new IPv6([0x64, 0xff9b, 0, 0, 0, 0, 0, 0]), 96],
      '6to4': [new IPv6([0x2002, 0, 0, 0, 0, 0, 0, 0]), 16],
      teredo: [new IPv6([0x2001, 0, 0, 0, 0, 0, 0, 0]), 32],
      reserved: [[new IPv6([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]), 32]]
    };

    IPv6.prototype.range = function() {
      return ipaddr.subnetMatch(this, this.SpecialRanges);
    };

    IPv6.prototype.isIPv4MappedAddress = function() {
      return this.range() === 'ipv4Mapped';
    };

    IPv6.prototype.toIPv4Address = function() {
      var high, low, _ref;
      if (!this.isIPv4MappedAddress()) {
        throw new Error("ipaddr: trying to convert a generic ipv6 address to ipv4");
      }
      _ref = this.parts.slice(-2), high = _ref[0], low = _ref[1];
      return new ipaddr.IPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
    };

    return IPv6;

  })();

  ipv6Part = "(?:[0-9a-f]+::?)+";

  ipv6Regexes = {
    "native": new RegExp("^(::)?(" + ipv6Part + ")?([0-9a-f]+)?(::)?$", 'i'),
    transitional: new RegExp(("^((?:" + ipv6Part + ")|(?:::)(?:" + ipv6Part + ")?)") + ("" + ipv4Part + "\\." + ipv4Part + "\\." + ipv4Part + "\\." + ipv4Part + "$"), 'i')
  };

  expandIPv6 = function(string, parts) {
    var colonCount, lastColon, part, replacement, replacementCount;
    if (string.indexOf('::') !== string.lastIndexOf('::')) {
      return null;
    }
    colonCount = 0;
    lastColon = -1;
    while ((lastColon = string.indexOf(':', lastColon + 1)) >= 0) {
      colonCount++;
    }
    if (string[0] === ':') {
      colonCount--;
    }
    if (string[string.length - 1] === ':') {
      colonCount--;
    }
    replacementCount = parts - colonCount;
    replacement = ':';
    while (replacementCount--) {
      replacement += '0:';
    }
    string = string.replace('::', replacement);
    if (string[0] === ':') {
      string = string.slice(1);
    }
    if (string[string.length - 1] === ':') {
      string = string.slice(0, -1);
    }
    return (function() {
      var _i, _len, _ref, _results;
      _ref = string.split(":");
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        part = _ref[_i];
        _results.push(parseInt(part, 16));
      }
      return _results;
    })();
  };

  ipaddr.IPv6.parser = function(string) {
    var match, parts;
    if (string.match(ipv6Regexes['native'])) {
      return expandIPv6(string, 8);
    } else if (match = string.match(ipv6Regexes['transitional'])) {
      parts = expandIPv6(match[1].slice(0, -1), 6);
      if (parts) {
        parts.push(parseInt(match[2]) << 8 | parseInt(match[3]));
        parts.push(parseInt(match[4]) << 8 | parseInt(match[5]));
        return parts;
      }
    }
    return null;
  };

  ipaddr.IPv4.isIPv4 = ipaddr.IPv6.isIPv6 = function(string) {
    return this.parser(string) !== null;
  };

  ipaddr.IPv4.isValid = ipaddr.IPv6.isValid = function(string) {
    var e;
    try {
      new this(this.parser(string));
      return true;
    } catch (_error) {
      e = _error;
      return false;
    }
  };

  ipaddr.IPv4.parse = ipaddr.IPv6.parse = function(string) {
    var parts;
    parts = this.parser(string);
    if (parts === null) {
      throw new Error("ipaddr: string is not formatted like ip address");
    }
    return new this(parts);
  };

  ipaddr.isValid = function(string) {
    return ipaddr.IPv6.isValid(string) || ipaddr.IPv4.isValid(string);
  };

  ipaddr.parse = function(string) {
    if (ipaddr.IPv6.isValid(string)) {
      return ipaddr.IPv6.parse(string);
    } else if (ipaddr.IPv4.isValid(string)) {
      return ipaddr.IPv4.parse(string);
    } else {
      throw new Error("ipaddr: the address has neither IPv6 nor IPv4 format");
    }
  };

  ipaddr.process = function(string) {
    var addr;
    addr = this.parse(string);
    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
      return addr.toIPv4Address();
    } else {
      return addr;
    }
  };

}).call(this);

},{}],248:[function(require,module,exports){
(function (process){
var util = require('util');

module.exports = (util && util.debuglog) || debuglog;

var debugs = {};
var debugEnviron = process.env.NODE_DEBUG || '';

function debuglog(set) {
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = util.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};

}).call(this,require('_process'))
},{"_process":147,"util":2}],"hdb":[function(require,module,exports){
// Copyright 2013 SAP AG.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http: //www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific
// language governing permissions and limitations under the License.
'use strict';

exports.util = require('./util');
exports.util.extend(exports, require('./protocol'));
exports.Client = require('./Client');

exports.createClient = function createClient(options) {
  return new exports.Client(options);
};

exports.connect = function connect(options, cb) {
  var client = exports.createClient(options);
  client.connect(cb);
  return client;
};

exports.createJSONStringifier = function createJSONStringifier() {
  return new exports.Stringifier({
    header: '[',
    footer: ']',
    seperator: ',',
    stringify: JSON.stringify
  });
};
},{"./Client":166,"./protocol":228,"./util":242}]},{},[]);
