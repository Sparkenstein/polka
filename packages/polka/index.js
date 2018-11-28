const http = require('http');
const Router = require('trouter');
const { parse } = require('querystring');
const parser = require('@polka/url');

/**
 * Check if the given charecter starts with `/`
 * Otherwise append `/` to the front.
 * @param {string} x input string
 * @example 
 * lead ('a')  => '/a';
 * lead('/d')  => '/d';
 */
function lead(x) {
	return x.charCodeAt(0) === 47 ? x : ('/' + x);
}

/**
 * Returns the value of substring in a path
 * @param {string} x input string
 * @example
 * value('abc/test/xyz')  => 'abc';
 * value('/pqr/mnb')  => '/pqr';
 */
function value(x) {
  let y = x.indexOf('/', 1);
  return y > 1 ? x.substring(0, y) : x;
}

/**
 * Mutates the gives request object by replacing
 * `req.url` and `req.path` values.
 * works same like removing first `str` number of
 * letters from given string for URL. 
 * else replace it with `/`
 * @param {string} str the string to mutate with
 * @param {object} req the req objet to mutate
 * @example 
 * mutate('google', {url:'google.com/api/search'}) => {url: '.com/api/search'}
 */
function mutate(str, req) {
	req.url = req.url.substring(str.length) || '/';
	req.path = req.path.substring(str.length) || '/';
}

/**
 * Error handler
 * @param {object} err error object
 * @param {object} req request object
 * @param {object} res response object
 * @param {object} next next middleware
 */
function onError(err, req, res, next) {
	let code = (res.statusCode = err.code || err.status || 500);
	res.end(err.length && err || err.message || http.STATUS_CODES[code]);
}

class Polka extends Router {
	constructor(opts={}) {
		super(opts);
		this.apps = {};
		this.wares = [];	// Middlewares
		this.bwares = {};
		this.parse = parser;
		this.server = opts.server;
		this.handler = this.handler.bind(this);
		this.onError = opts.onError || onError; // catch-all handler
		this.onNoMatch = opts.onNoMatch || this.onError.bind(null, { code:404 });	// Default 404
	}

	add(method, pattern, ...fns) {
		let base = lead(value(pattern));
		if (this.apps[base] !== void 0) throw new Error(`Cannot mount ".${method.toLowerCase()}('${lead(pattern)}')" because a Polka application at ".use('${base}')" already exists! You should move this handler into your Polka application instead.`);
		return super.add(method, pattern, ...fns);
	}

	/**
	 * Add middlewares or other sub applications
	 * to the existing application. if first 
	 * parameter is a function, or just `/` push
	 * it to the wares array, else push them
	 * to apps or bwares objects according to
	 * the `instanceof` value
	 * @param {string} base the base path where	the following middleware is supposed to mount
	 * @param  {...any} fns array of middleware functions/polka apps
	 * @example
	 * polka().use(validateUser, login)
	 * polka().use('/users', addUser)
	 */
	use(base, ...fns) {
		if (typeof base === 'function') {
			this.wares = this.wares.concat(base, fns);
		} else if (base === '/') {
			this.wares = this.wares.concat(fns);
		} else {
			base = lead(base);
			fns.forEach(fn => {
				if (fn instanceof Polka) {
					this.apps[base] = fn;
				} else {
					let arr = this.bwares[base] || [];
					arr.length > 0 || arr.push((r, _, nxt) => (mutate(base, r),nxt()));
					this.bwares[base] = arr.concat(fn);
				}
			});
		}
		return this; // chainable
	}
	 
	/**
	 * Wrapper around native http.createServer()
	 * Create a new server if opts.server is 
	 * undefined/not given. Otherwise listen on 
	 * the given port
	 */
	listen() {
		(this.server = this.server || http.createServer()).on('request', this.handler);
		this.server.listen.apply(this.server, arguments);
		return this;
	}

	handler(req, res, info) {
		info = info || this.parse(req);
		let fns=[], arr=this.wares, obj=this.find(req.method, info.pathname);
		req.originalUrl = req.originalUrl || req.url;
		let base = value(req.path = info.pathname);
		if (this.bwares[base] !== void 0) {
			arr = arr.concat(this.bwares[base]);
		}
		if (obj) {
			fns = obj.handlers;
			req.params = obj.params;
		} else if (this.apps[base] !== void 0) {
			mutate(base, req); info.pathname=req.path; //=> updates
			fns.push(this.apps[base].handler.bind(null, req, res, info));
		} else if (fns.length === 0) {
			fns.push(this.onNoMatch);
		}
		// Grab addl values from `info`
		req.search = info.search;
		req.query = parse(info.query);
		// Exit if only a single function
		let i=0, len=arr.length, num=fns.length;
		if (len === i && num === 1) return fns[0](req, res);
		// Otherwise loop thru all middlware
		let next = err => err ? this.onError(err, req, res, next) : loop();
		let loop = _ => res.finished || (i < len) && arr[i++](req, res, next);
		arr = arr.concat(fns);
		len += num;
		loop(); // init
	}
}

module.exports = opts => new Polka(opts);
