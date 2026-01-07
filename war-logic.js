window.warRoom = function() {
    return {
        // --- CONFIG ---
        version: '2.3.6', // Incremented version to force cache refresh
        sbUrl: 'https://kjyikmetuciyoepbdzuz.supabase.co',
        sbKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeWlrbWV0dWNpeW9lcGJkenV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNTMyNDUsImV4cCI6MjA4MjkyOTI0NX0.0bxEk7nmkW_YrlVsCeLqq8Ewebc2STx4clWgCfJus48',

        // --- STATE ---
        tab: 'warroom', loading: true, mobileMenu: false, searchQuery: '', refSearch: '', debugStatus: 'Ready',
        alliances: [], players: [], openGroups: [], openServers: [], openAlliances: [],
        authenticated: false, passInput: '', editTag: '', managerName: '',
        importData: '', isImporting: false, comparisonTarget: null,
        displayClock: '', currentRoundText: '', currentPhase: '', phaseCountdown: '',
        seasonStart: new Date("2026-01-05T03:00:00+01:00"), 

        async init() {
            const storedVersion = localStorage.getItem('war_app_version');
            if (storedVersion !== this.version) {
                localStorage.removeItem('war_data_cache');
                localStorage.setItem('war_app_version', this.version);
                window.location.reload(true);
                return;
            }
            this.client = supabase.createClient(this.sbUrl, this.sbKey);
            this.myAllianceName = localStorage.getItem('war_ref_alliance') || '';
            await this.fetchData();
            if (this.myAllianceName) { this.autoExpandMyGroup(); }
            const savedKey = localStorage.getItem('war_admin_key');
            if (savedKey) { this.passInput = savedKey; await this.login(true); }
            this.updateClock();
            setInterval(() => this.updateClock(), 1000);
        },

        async fetchData() {
            try {
                const [resM, resP] = await Promise.all([
                    this.client.from('war_master_view').select('*'),
                    this.client.from('players').select('*').order('thp', { ascending: false })
                ]);
                this.alliances = resM.data || [];
                this.players = resP.data || [];
            } catch (e) { console.error("Fetch Error:", e); }
            this.loading = false;
        },

        get factionData() {
            const now = new Date();
            const cetNow = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
            const warTime = this.getNextWarTime();
            
            return this.alliances.map(a => {
                let rate = Number(a.observed_rate) > 0 ? Number(a.observed_rate) : Number(a.city_rate || 0);
                const scoutTime = a.last_scout_time ? new Date(a.last_scout_time) : cetNow;
                const hoursSinceScout = Math.max(0, (cetNow - scoutTime) / 3600000);
                const hoursUntilWar = Math.max(0, (warTime - cetNow) / 3600000);
                const currentStash = Number(a.last_copper || 0) + (rate * hoursSinceScout);
                const warStash = currentStash + (rate * hoursUntilWar);
                
                // Calculate Ace for Servers Intel
                const roster = this.players.filter(p => p.alliance_id === a.alliance_id);
                const ace = roster.length > 0 ? roster[0] : { name: 'N/A', thp: 0 };

                return { 
                    ...a, 
                    stash: currentStash, 
                    warStash: warStash, 
                    rate: rate,
                    ace_name: ace.name,
                    ace_thp: ace.thp
                };
            });
        },

        getNextWarTime() {
            const now = new Date();
            const cet = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
            let target = new Date(cet);
            target.setHours(15, 30, 0, 0);
            let safety = 0;
            while (safety < 14) {
                const day = target.getDay();
                if ((day === 3 || day === 6) && target > cet) return target;
                target.setDate(target.getDate() + 1);
                safety++;
            }
            return target;
        },

        updateClock() {
            const now = new Date();
            const cet = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
            this.displayClock = cet.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
            if (cet < this.seasonStart) {
                this.currentRoundText = "PRE-SEASON"; this.currentPhase = "Awaiting Week 1";
                const diff = this.seasonStart - cet;
                const d = Math.floor(diff/864e5), h = Math.floor((diff%864e5)/36e5), m = Math.floor((diff%36e5)/6e4), s = Math.floor((diff%6e4)/1e3);
                this.phaseCountdown = `${d}d : ${h}h : ${m}m : ${s}s`; this.week = 1; return;
            }
            const diffDays = Math.floor((cet - this.seasonStart) / 864e5);
            this.week = Math.max(1, Math.min(4, Math.floor(diffDays / 7) + 1));
            const day = cet.getDay(), hr = cet.getHours(), min = cet.getMinutes();
            let phase = ""; let targetTime = new Date(cet);
            const isR1 = (day >= 1 && day < 4 && !(day === 4 && hr >= 3));
            this.currentRoundText = `Week ${this.week} | Round ${isR1 ? 1 : 2}`;
            if (isR1) {
                if (day === 1 || (day === 2 && hr < 3)) { phase = "Grouping Phase"; targetTime.setDate(cet.getDate() + (day === 1 ? 1 : 0)); targetTime.setHours(3,0,0,0); }
                else if (day === 2 || (day === 3 && hr < 3)) { phase = "Declaration Stage"; targetTime.setDate(cet.getDate() + (day === 2 ? 1 : 0)); targetTime.setHours(3,0,0,0); }
                else if (day === 3 && hr < 15) { phase = "Invitation Phase"; targetTime.setHours(15,0,0,0); }
                else if (day === 3 && hr === 15 && min < 30) { phase = "Preparation"; targetTime.setHours(15,30,0,0); }
                else { phase = "WAR ACTIVE"; targetTime.setDate(cet.getDate() + 1); targetTime.setHours(3,0,0,0); }
            } else {
                if (day === 4 || (day === 5 && hr < 3)) { phase = "Grouping Phase"; targetTime.setDate(cet.getDate() + (day === 4 ? 1 : 0)); targetTime.setHours(3,0,0,0); }
                else if (day === 5 || (day === 6 && hr < 3)) { phase = "Declaration Stage"; targetTime.setDate(cet.getDate() + (day === 5 ? 1 : 0)); targetTime.setHours(3,0,0,0); }
                else if (day === 6 && hr < 15) { phase = "Invitation Phase"; targetTime.setHours(15,0,0,0); }
                else if (day === 6 && hr === 15 && min < 30) { phase = "Preparation"; targetTime.setHours(15,30,0,0); }
                else if (day === 6 || (day === 0 && hr < 3)) { phase = "WAR ACTIVE"; targetTime.setDate(cet.getDate() + (day === 6 ? 1 : 0)); targetTime.setHours(3,0,0,0); }
                else { phase = "Rest Phase"; targetTime.setDate(cet.getDate() + (day === 0 ? 1 : 7-day+1)); targetTime.setHours(3,0,0,0); }
            }
            this.currentPhase = phase; const dff = targetTime - cet;
            this.phaseCountdown = `${Math.floor(dff/36e5)}h : ${Math.floor((dff%36e5)/6e4)}m : ${Math.floor((dff%6e4)/1e3)}s`;
        },

        getGroupedFaction(fName) {
            // Safety: ensure faction exists before toLowerCase()
            const sorted = this.factionData
                .filter(a => (a.faction || '').toLowerCase().includes((fName || '').toLowerCase()))
                .sort((a,b) => b.stash - a.stash);
            
            const groups = []; 
            const step = this.week === 1 ? 10 : (this.week === 2 ? 6 : 3);
            let i = 0;
            
            while (i < 30 && i < sorted.length) {
                groups.push({ 
                    id: Math.floor(i/step)+1, 
                    label: `Rank ${i+1}-${Math.min(i+step, 30)}`, 
                    alliances: sorted.slice(i, i+step).map((it, idx) => ({ ...it, factionRank: i+idx+1 })) 
                });
                i += step;
            }
            if (sorted.length > 30) { 
                groups.push({ 
                    id: groups.length + 1, 
                    label: "Rank 31-100", 
                    alliances: sorted.slice(30, 100).map((it, idx) => ({ ...it, factionRank: 31+idx })) 
                }); 
            }
            return groups;
        },

        autoExpandMyGroup() {
            const me = this.alliances.find(a => a.name === this.myAllianceName);
            if (me && me.faction) {
                const groups = this.getGroupedFaction(me.faction);
                const myG = groups.find(g => g.alliances.some(x => x.alliance_id === me.alliance_id));
                if (myG) { 
                    const key = `${me.faction}-${myG.id}`; 
                    if(!this.openGroups.includes(key)) this.openGroups.push(key); 
                }
            }
        },

        openComparison(targetAlliance) {
            const me = this.alliances.find(a => a.name === this.myAllianceName);
            if (!me) return alert("Select your Alliance in the sidebar first.");
            this.comparisonTarget = {
                me: { name: me.name, tag: me.tag, roster: this.getPlayersForAlliance(me.alliance_id) },
                them: { name: targetAlliance.name, tag: targetAlliance.tag, roster: this.getPlayersForAlliance(targetAlliance.alliance_id) }
            };
        },

        // --- HELPERS ---
        get knsTotalStash() { return this.factionData.filter(a => (a.faction || '').toLowerCase().includes('kage')).reduce((s, a) => s + a.stash, 0); },
        get kbtTotalStash() { return this.factionData.filter(a => (a.faction || '').toLowerCase().includes('koubu')).reduce((s, a) => s + a.stash, 0); },
        get knsGroups() { return this.getGroupedFaction('Kage'); },
        get kbtGroups() { return this.getGroupedFaction('Koubu'); },
        
        get groupedForces() {
            const groups = {};
            this.factionData.forEach(a => { 
                const srv = a.server || 'Unknown';
                if (!groups[srv]) groups[srv] = []; 
                groups[srv].push(a); 
            });
            Object.keys(groups).forEach(s => groups[s].sort((a,b) => (b.ace_thp || 0) - (a.ace_thp || 0)));
            return groups;
        },

        getFilteredRefList() {
            if (!this.refSearch) return [];
            const q = this.refSearch.toLowerCase();
            return [...this.alliances]
                .filter(a => (a.tag || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q))
                .sort((a,b) => (a.name || '').localeCompare(b.name || ''))
                .slice(0, 8);
        },

        setReferenceAlliance(name) { this.myAllianceName = name; localStorage.setItem('war_ref_alliance', name); this.refSearch = ''; this.autoExpandMyGroup(); },
        formatNum(v) { return Math.floor(v || 0).toLocaleString(); },
        formatPower(v) { return (Number(v || 0)/1000000000).toFixed(2) + 'B'; },
        matchesSearch(a) { const q = this.searchQuery.toLowerCase(); return !q || (a.name || '').toLowerCase().includes(q) || (a.tag || '').toLowerCase().includes(q); },
        toggleGroup(f, id) { const key = `${f}-${id}`; this.openGroups = this.openGroups.includes(key) ? this.openGroups.filter(k => k !== key) : [...this.openGroups, key]; },
        isGroupOpen(f, id) { return this.openGroups.includes(`${f}-${id}`); },
        toggleServerCollapse(s) { this.openServers = this.openServers.includes(s) ? this.openServers.filter(x => x !== s) : [...this.openServers, s]; },
        isServerOpen(s) { return this.openServers.includes(s); },
        toggleAlliance(id) { this.openAlliances = this.openAlliances.includes(id) ? this.openAlliances.filter(x => x !== id) : [...this.openAlliances, id]; },
        isAllianceOpen(id) { return this.openAlliances.includes(id); },
        
        getPlayersForAlliance(id) { 
            if (!id) return [];
            return this.players.filter(p => p.alliance_id === id); 
        },

        isAllyServer(group) { 
            const me = this.alliances.find(a => a.name === this.myAllianceName); 
            return me ? group.some(a => a.faction === me.faction) : true; 
        },

        isMatch(t) { 
            const me = this.alliances.find(a => a.name === this.myAllianceName); 
            if (!me || !t.faction || !me.faction || t.faction === me.faction || t.faction === 'Unassigned') return false; 
            const myG = this.getGroupedFaction(me.faction).find(g => g.alliances.some(x => x.alliance_id === me.alliance_id))?.id;
            const taG = this.getGroupedFaction(t.faction).find(g => g.alliances.some(x => x.tag === t.tag))?.id;
            return myG && taG && myG === taG; 
        },

        async login(isAuto = false) {
            try {
                const { data } = await this.client.from('authorized_managers').select('manager_name').eq('secret_key', this.passInput).single();
                if (data) { this.authenticated = true; this.managerName = data.manager_name; localStorage.setItem('war_admin_key', this.passInput); }
            } catch(e) {}
        },

        async saveCitiesToDB() {
            const a = this.alliances.find(x => x.tag === this.editTag); if (!a) return;
            await this.client.from('cities').upsert({ alliance_id: a.alliance_id, l1:a.l1, l2:a.l2, l3:a.l3, l4:a.l4, l5:a.l5, l6:a.l6 });
            alert("Saved!"); await this.fetchData();
        },

        copyScoutPrompt() { 
            const prompt = `Convert raw OCR text into JSON array: [{"tag": "TAG", "name": "Name", "stash": 12345000}]. DATA:\n${this.importData}`;
            navigator.clipboard.writeText(prompt); alert("AI Prompt Copied!");
        },

        async processImport() {
            this.isImporting = true;
            try {
                const cleanData = JSON.parse(this.importData); let count = 0;
                for (const item of cleanData) {
                    const alliance = this.alliances.find(a => a.tag.toLowerCase() === item.tag.toLowerCase());
                    if (alliance) { await this.client.from('history').insert({ alliance_id: alliance.alliance_id, copper: item.stash }); count++; }
                }
                alert(`Imported ${count} scouts.`); this.importData = '';
            } catch (e) { alert("Error: JSON format invalid."); }
            this.isImporting = false; await this.fetchData();
        },

        getCityCount(n) { const a = this.alliances.find(x => x.tag === this.editTag); return a ? a['l'+n] : 0; },
        getTotalCities() { const a = this.alliances.find(x => x.tag === this.editTag); return a ? [1,2,3,4,5,6].reduce((s,i)=>s+Number(a['l'+i]),0) : 0; },
        updateCity(n, d) { const a = this.alliances.find(x => x.tag === this.editTag); if (a) { if (d > 0 && this.getTotalCities() >= 6) return alert("Max 6 cities!"); a['l'+n] = Math.max(0, Number(a['l'+n]) + d); }},
        saveSettings() { localStorage.setItem('war_ref_alliance', this.myAllianceName); }
    }
}
