/** ----------------------------------------------------------------------
 * @module [Lgr]
 * @author [APG] ANGELI Paolo Giusto
 * @version 0.2.0 [APG 2018/06/02]
 * @version 0.5.0 [APG 2018/11/24]
 * @version 0.7.1 [APG 2019/08/28] 
 * @version 0.8.0 [APG 2022/03/19] Porting to deno 
 * @version 0.9.0 [APG 2022/08/09] Code smells and metrics
 * @version 0.9.1 [APG 2022/09/24] Splitting renaming etc 
 * @version 0.9.2 [APG 2022/09/24] Github Beta 
 * -----------------------------------------------------------------------
 */

import {
  MongoCollection, StdPath, Uts, Rst, Mng
} from '../../deps.ts';

import { ApgLgrEvent } from './ApgLgrEvent.ts'
import { IApgLgr } from '../interfaces/IApgLgr.ts'
import { IApgLgrTransport } from '../interfaces/IApgLgrTransport.ts'
import { eApgLgrTransportTypes } from "../enums/eApgLgrTransportTypes.ts";


export class ApgLgr {

  /** A session name to group loggers together inside a common persistent repository. 
   * It is used to name the files for file trasnport and group the loggers in the mongo database*/
  private static _session = "";

  /** The Id of the next Event logger in the current session*/
  private static _nextId = 0;

  /** Number of times the logger was flushed. 
   * It is used by the file transport to add a comma separator */
  private static _flushCount = 0;

  /** The transports used to flush the logger */
  private static readonly _transports: Map<eApgLgrTransportTypes, IApgLgrTransport> = new Map();

  /** Current logger index in this logging session*/
  id = 0;

  /** Current logging session reference */
  session: string;

  /** Logger name to help identification*/
  name: string;

  /** This creation date is used to sort data in Mongo DB storage */
  creationTime: Date = new Date();

  /** High resolution timer creation */
  creationHrt = performance.now();

  /** Events traced between cration and flush */
  events: ApgLgrEvent[] = [];

  /** Leve indicator of nested log calls */
  depth = 0;

  /** At least one of the logged events is an error */
  hasErrors = false;

  /** Total time in milliseconds between creation and flush*/
  totalHrt = 0;

  constructor(aname: string) {
    this.name = aname;
    this.id = ++ApgLgr._nextId;
    this.session = ApgLgr._session;
  }

  /** Generates and logs an event
   * @param aclass Class where the event is happening
   * @param amethod Method's name where the event is happening
   * @param aresult 
   * @returns A reference to the event's object just created and queued
   */
  log(
    aclass: string,
    amethod: string,
    aresult?: Rst.ApgRst
  ) {

    const r = new ApgLgrEvent(
      this.depth,
      aclass,
      amethod,
      aresult
    );
    this.events.push(r);

    if (aresult) {
      if (!aresult.Ok) {
        this.hasErrors = true;
      }
      if (ApgLgr._transports.has(eApgLgrTransportTypes.console)) {
        console.log(`${this.name} => ${aclass}.${amethod}:`);
        const r = aresult.AsImmutableIApgRst;
        console.log(`    (code:${r.error}) message: ${r.message}`);
        if (r.payload) {
          console.dir(r.payload);
        }
      }
    }
    return r;
  }

  static Session(asession: string) {
    this._session = asession;
    this._nextId = 0;
    this._flushCount = 0;
  }


  static AddConsoleTransport() {
    const consoleTransport: IApgLgrTransport = {
      type: eApgLgrTransportTypes.console
    }
    ApgLgr._transports.set(eApgLgrTransportTypes.console, consoleTransport);
  }

  /**
   * @param alogsDevPath Must exist and have file write permissions
   * @param afile 
   * @remarks Exits Deno on write permission errors
   */
  static async AddFileTransport(alogsDevPath: string, afile: string) {
    const path = StdPath.resolve(alogsDevPath);

    try {
      const status = await Deno.permissions.query({ name: "write", path: path });

      Rst.ApgRstAssert.IsFalse(
        status.state == "granted",
        `Come on! We cant'use ${this.AddFileTransport.name} without file write permissions!`,
        true
      );
    }
    catch (error) {
      console.dir(error);
      Deno.exit();
    }

    const fileTransport: IApgLgrTransport = {
      type: eApgLgrTransportTypes.file,
      file: StdPath.join(path, "/", afile)
    }
    
    ApgLgr._transports.set(eApgLgrTransportTypes.file, fileTransport);
  }

  static AddMongoTransport(acollection: MongoCollection<IApgLgr>, amode: Mng.eApgMngMode) {

    const transportType = (amode == Mng.eApgMngMode.local) ?
      eApgLgrTransportTypes.mongoLocal :
      eApgLgrTransportTypes.mongoAtlas;
    
    const mongoTransport: IApgLgrTransport = {
      type: transportType,
      collection: acollection
    }

    ApgLgr._transports.set(transportType, mongoTransport);

  }

  /**
   * Transfers accumulated data to the initialized transports. 
   * Returns the total flush time.
   */
  async flush() {

    const now = performance.now();
    this.totalHrt = now - this.creationHrt;

    const fileTransport = ApgLgr._transports.get(eApgLgrTransportTypes.file)
    if (fileTransport) {
      await this.#flushFile(fileTransport.file!, this);
    }

    const mongoLocalTrasport = ApgLgr._transports.get(eApgLgrTransportTypes.mongoLocal);
    if (mongoLocalTrasport) {
      await this.#flushMongo(mongoLocalTrasport.collection!, this);
    }

    const mongoAtlasTrasport = ApgLgr._transports.get(eApgLgrTransportTypes.mongoAtlas);
    if (mongoAtlasTrasport) {
      await this.#flushMongo(mongoAtlasTrasport.collection!, this);
    }

    ApgLgr._flushCount++;

    Rst.ApgRstAssert.IsFalse(
      this.depth === 0,
      `The logger with ID=[${this.id}], named: [${this.name}] was flushed with depth of: [${this.depth}] instead of Zero. There are mismatches in begin-end profiling.`,
      true
    )

    const r = performance.now() - now;
    return r;
  }


  public elapsedSinceStart() {
    const lastEventIndex = this.events.length - 1;
    let r = 0;
    if (lastEventIndex > 0) {
      const firstHrt = this.events[0]!.hrt;
      const lastHrt = this.events[lastEventIndex].hrt;
      const deltaHrt = lastHrt - firstHrt;
      r = Uts.ApgUtsMath.RoundToSignificant(deltaHrt, 6);
    }
    return r;
  }

  async #flushFile(afile: string, aentry: IApgLgr) {

    const jsonEntry = JSON.stringify(aentry, undefined, 2);
    const comma = (ApgLgr._flushCount == 0) ? "" : ",\n";
    const textEntry = comma + jsonEntry;
    await Deno.writeTextFile(afile, textEntry, { append: true });

  }

  async #flushMongo(acollection: MongoCollection<IApgLgr>, aentry: IApgLgr) {

    await acollection.insertOne(aentry);

  }

  static ClearTrasports() {

    this._transports.clear();

  }

}
